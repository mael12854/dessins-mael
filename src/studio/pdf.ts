// Import d'un PDF : chaque page devient une image (pdf.js, chargé seulement quand on importe un PDF).
export const MAX_PAGES = 30;
export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Rend chaque page en image, à 300 ppp (A4 = 2480 × 3508 px), sans dépasser 3508 px de côté. */
export async function pdfToImages(file: File, progress?: (page: number, total: number) => void): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if ((err as Error)?.name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe.');
    throw new Error('Ce fichier PDF est illisible.');
  }
  try {
    const total = doc.numPages;
    if (total > MAX_PAGES) throw new Error(`Ce PDF a ${total} pages : ${MAX_PAGES} au maximum.`);
    const out: Blob[] = [];
    for (let i = 1; i <= total; i++) {
      progress?.(i, total);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(300 / 72, 3508 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: '#FFFFFF' }).promise;
      out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Page illisible.'))), 'image/jpeg', 0.95)));
      page.cleanup();
      canvas.width = canvas.height = 0; // libère la mémoire tout de suite (iPhone)
    }
    return out;
  } finally {
    await task.destroy(); // libère le document et le « worker »
  }
}
