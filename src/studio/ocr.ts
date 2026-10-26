// « Lire l'écriture » : envoie une zone (ou toute la planche) au serveur, montre ce qui a été lu,
// laisse corriger, puis remplace l'écriture par du texte tapé (cache + texte, annulable).
import type { Box, Editor, Replacement } from './editor';
import { FONTS, type FontKey } from './model';

const MAX_SIDE = 1568; // au-delà, l'image est réduite par le service de toute façon

interface Deps {
  editor: Editor;
  canvas: () => HTMLCanvasElement | null; // dessin nettoyé, taille d'origine
  code: () => string;
}
interface Entry { box: Box; text: string; keep: boolean }

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** Découpe une zone (avec une marge) et l'encode en JPEG pour l'envoi. */
function crop(src: HTMLCanvasElement, box: Box | null) {
  const b = box
    ? (() => {
        const m = Math.round(Math.max(box.w, box.h) * 0.06);
        const x = Math.max(0, box.x - m), y = Math.max(0, box.y - m);
        return { x, y, w: Math.min(src.width, box.x + box.w + m) - x, h: Math.min(src.height, box.y + box.h + m) - y };
      })()
    : { x: 0, y: 0, w: src.width, h: src.height };
  const k = Math.min(1, MAX_SIDE / Math.max(b.w, b.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w * k)); c.height = Math.max(1, Math.round(b.h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.92);
  return { url, base64: url.split(',')[1] };
}

export function setupOcr({ editor, canvas, code }: Deps) {
  const dlg = $<HTMLDialogElement>('[data-ocr-dialog]');
  const status = $('[data-ocr-status]', dlg);
  const list = $('[data-ocr-list]', dlg);
  const fontSel = $<HTMLSelectElement>('[data-ocr-font]', dlg);
  const weightSel = $<HTMLSelectElement>('[data-ocr-weight]', dlg);
  const cover = $<HTMLInputElement>('[data-ocr-cover]', dlg);
  const apply = $<HTMLButtonElement>('[data-ocr-apply]', dlg);
  const retry = $<HTMLButtonElement>('[data-ocr-retry]', dlg);
  let entries: Entry[] = [];
  let last: { box: Box | null } = { box: null };
  let busy = false;

  for (const k of Object.keys(FONTS) as FontKey[]) fontSel.append(new Option(FONTS[k].label, k));
  const fillWeights = () => {
    const ws = FONTS[fontSel.value as FontKey].weights;
    const prev = Number(weightSel.value) || 700;
    weightSel.replaceChildren(...ws.map((w) => new Option(String(w), String(w))));
    weightSel.value = String(ws.includes(prev) ? prev : ws.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a)));
    weightSel.disabled = ws.length < 2;
  };
  fontSel.value = 'hand'; fillWeights(); weightSel.value = '700';
  fontSel.addEventListener('change', fillWeights);

  const setStatus = (text: string, error = false) => { status.textContent = text; status.classList.toggle('msg', error); status.classList.toggle('hint', !error); };

  async function call(mode: 'zone' | 'page', base64: string) {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-code': code() },
      body: JSON.stringify({ action: 'ocr', mode, media: 'image/jpeg', base64 }),
    });
    const data = await res.json().catch(() => ({ error: `Erreur ${res.status}` }));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  function renderList() {
    list.replaceChildren();
    const src = canvas();
    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'ocr-row';
      const head = document.createElement('label');
      head.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = e.keep;
      cb.addEventListener('change', () => { e.keep = cb.checked; updateApply(); });
      head.append(cb, entries.length > 1 ? ` Texte ${i + 1}` : ' Remplacer ce texte');
      const img = document.createElement('img');
      img.className = 'ocr-crop'; img.alt = 'Écriture d’origine';
      if (src) img.src = crop(src, e.box).url;
      const ta = document.createElement('textarea');
      ta.rows = Math.min(6, Math.max(2, e.text.split('\n').length + 1));
      ta.value = e.text; ta.lang = 'fr'; ta.spellcheck = true;
      ta.setAttribute('aria-label', `Texte lu ${i + 1}`);
      ta.addEventListener('input', () => { e.text = ta.value; updateApply(); });
      const focus = () => editor.showZone(e.box);
      ta.addEventListener('focus', focus); row.addEventListener('mouseenter', focus);
      row.append(head, img, ta);
      list.append(row);
    });
    updateApply();
  }
  const updateApply = () => { apply.disabled = busy || !entries.some((e) => e.keep && e.text.trim()); };

  async function read(box: Box | null) {
    const src = canvas();
    if (!src) return;
    last = { box };
    entries = [];
    busy = true; retry.disabled = true;
    list.replaceChildren();
    if (box) { const img = document.createElement('img'); img.className = 'ocr-crop'; img.src = crop(src, box).url; img.alt = ''; list.append(img); }
    setStatus(box ? 'Lecture de l’écriture…' : 'Lecture de toute la planche… (quelques secondes)');
    updateApply();
    if (!dlg.open) dlg.showModal();
    try {
      const { base64 } = crop(src, box);
      if (box) {
        const r = await call('zone', base64);
        entries = r.text ? [{ box, text: r.text, keep: true }] : [];
        setStatus(r.text ? 'Vérifie et corrige si besoin, puis « Remplacer ».' : 'Aucun texte lu dans cette zone. Corrige le cadre ou écris le texte toi-même.', !r.text);
        if (!r.text) entries = [{ box, text: '', keep: true }];
      } else {
        const r = await call('page', base64);
        const W = src.width, H = src.height;
        entries = (r.items as { text: string; x0: number; y0: number; x1: number; y1: number }[]).map((it) => ({
          text: it.text, keep: true,
          box: { x: Math.round((it.x0 / 1000) * W), y: Math.round((it.y0 / 1000) * H), w: Math.round(((it.x1 - it.x0) / 1000) * W), h: Math.round(((it.y1 - it.y0) / 1000) * H) },
        }));
        setStatus(entries.length
          ? `${entries.length} texte(s) trouvé(s). Vérifie chaque texte ; décoche ceux à garder tels quels. Les cadres sont ajustables après coup.`
          : 'Aucun texte manuscrit trouvé sur la planche.', !entries.length);
      }
      busy = false;
      renderList();
    } catch (err) {
      busy = false;
      setStatus((err as Error).message, true);
      updateApply();
    } finally { retry.disabled = false; }
  }

  apply.addEventListener('click', () => {
    const chosen: Replacement[] = entries.filter((e) => e.keep && e.text.trim()).map((e) => ({ box: e.box, text: e.text.trim() }));
    editor.replaceWithText(chosen, {
      font: fontSel.value as FontKey, weight: Number(weightSel.value), color: '#1A1816', cover: cover.checked,
    });
    dlg.close();
  });
  retry.addEventListener('click', () => read(last.box));
  $('[data-ocr-cancel]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (editor.tool === 'ocr') editor.clearZone(); else editor.showZone(null); });

  return { readZone: (box: Box) => read(box), readPage: () => read(null) };
}
