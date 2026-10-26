// Nettoyage du fond des dessins (partagé par l'admin et le Studio).
// Le papier (teinte la plus fréquente) devient blanc, les traits sont renforcés,
// l'ombre du scanner sur les bords est effacée. Pour une signature, le papier
// devient transparent et le trait noir feutre.

export function cleanImageData(im: ImageData, transparent = false): ImageData {
  const { width: w, height: h, data: d } = im;
  const n = w * h;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0]++;
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.6) { paper = v; break; }
  }
  paper = Math.max(paper, 120);
  const curve = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const x = v / paper;
    curve[v] = x >= 0.86 ? 255 : 255 * Math.pow(x / 0.86, 1.8);
  }
  // Bords du scan : blanchis sur 0,8 %.
  const m = transparent ? 0 : Math.round(Math.max(w, h) * 0.008);
  for (let i = 0; i < d.length; i += 4) {
    const p = i / 4;
    const px = p % w;
    const py = (p / w) | 0;
    if (px < m || py < m || px >= w - m || py >= h - m) { d[i] = d[i + 1] = d[i + 2] = 255; continue; }
    const r = curve[d[i]], g = curve[d[i + 1]], b = curve[d[i + 2]];
    if (transparent) {
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      d[i] = 0x1a; d[i + 1] = 0x18; d[i + 2] = 0x16; d[i + 3] = Math.min(d[i + 3], 255 - lum);
    } else {
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  return im;
}

export function cleanCanvas(ctx: CanvasRenderingContext2D, w: number, h: number, transparent = false) {
  const im = ctx.getImageData(0, 0, w, h);
  ctx.putImageData(cleanImageData(im, transparent), 0, 0);
}
