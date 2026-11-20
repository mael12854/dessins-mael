// Spécimens Studio : écran des brouillons, import, sauvegarde locale,
// raccourcis, export PNG et envoi vers le formulaire de publication de l'admin.
import { Editor, type Tool, type View } from './editor';
import { Panel } from './panel';
import { FONTS, newDoc, uid, type Doc } from './model';
import { cleanImageData } from '../lib/clean-paper';
import {
  askPersistence, bookPages, deleteProject, getOriginal, getProject, listProjects, putOriginal, putProject, setHandoff,
  type HandoffPage, type ProjectRecord, type Slot,
} from '../lib/studio-db';
import { isPdf, MAX_PAGES, pdfToImages } from './pdf';

type SpecRef = { folder: string; n: number; title: string; fiche: boolean; orig: { planche: string | null; espece: string | null; pages: string[] } };

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const specs: SpecRef[] = JSON.parse($('#studio-specs').textContent || '[]');
const UPLOAD_LIMIT = 4_200_000; // base64, limite d'une requête Vercel (même valeur que l'API)
const MAX_PIXELS = 16_000_000; // limite des canevas sur iPhone/iPad

const screens = { login: $('[data-screen=login]'), home: $('[data-screen=home]'), editor: $('[data-screen=editor]') };
function show(s: keyof typeof screens) { for (const [k, el] of Object.entries(screens)) el.hidden = k !== s; }

const busy = $('[data-busy]');
function setBusy(text: string | null) { busy.hidden = !text; $('[data-busy-text]').textContent = text ?? ''; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ————— Accès (même code que l'admin) —————
let code = '';
let bigUploads = false; // Vercel Blob branché : images publiées en PNG sans perte jusqu'à 40 Mo
const BIG_LIMIT = 40 * 1024 * 1024; // même valeur que src/lib/send-image.ts
try { code = sessionStorage.getItem('admin-code') || ''; } catch {}

async function checkCode(c: string) {
  const res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-code': c }, body: JSON.stringify({ action: 'login' }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  code = c;
  bigUploads = !!data.bigUploads;
  try { sessionStorage.setItem('admin-code', c); } catch {}
}

$('[data-login]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('[data-login] [name=code]');
  const msg = $('[data-login-msg]');
  try { await checkCode(input.value); msg.hidden = true; start(); }
  catch (err) { msg.textContent = (err as Error).message; msg.hidden = false; }
});

// ————— Éditeur —————
let current: ProjectRecord | null = null;
let originalInfo = '';
const panelRoot = $('[data-panel]');
const editor = new Editor($<HTMLDivElement>('[data-canvas]'), {
  change: (doc, committed) => {
    scheduleSave();
    if (committed && !panelRoot.contains(document.activeElement)) panel.render();
  },
  select: (it) => { panel.tab = it ? 'props' : 'layers'; panel.render(); document.body.classList.toggle('has-selection', !!it); },
  tool: (t) => {
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    const hints: Partial<Record<Tool, string>> = {
      text: 'Touche la planche à l’endroit du texte', label: 'Touche la planche pour placer l’étiquette', 'bubble-oval': 'Touche la planche pour placer la bulle',
      'bubble-rect': 'Touche la planche pour placer la bulle', 'bubble-thought': 'Touche la planche pour placer la pensée',
      arrow: 'Touche la planche pour placer la flèche', marker: 'Peins sur l’écriture à cacher', pen: 'Dessine sur la feuille',
    };
    const hint = $('[data-tool-hint]');
    hint.textContent = hints[t] ?? '';
    hint.hidden = !hints[t];
    panel.render();
    if ((t === 'marker' || t === 'pen') && matchMedia('(pointer: coarse)').matches) document.body.classList.remove('sheet-open');
  },
  zoom: (s) => { $('[data-zoom-label]').textContent = `${Math.round(s * 100)} %`; },
  history: (u, r) => { $<HTMLButtonElement>('[data-undo]').disabled = !u; $<HTMLButtonElement>('[data-redo]').disabled = !r; },
  editText: () => { openSheet(); panel.focusText(); },
});
const panel = new Panel(panelRoot, editor, () => openSheet());
// Accès pour les tests automatisés, uniquement en développement (absent du site en ligne).
if (import.meta.env.DEV) (window as any).__studio = { editor, panel };

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
  b.addEventListener('click', () => {
    // Même comportement à la souris, au doigt et au stylet : on choisit l'outil, puis on touche la planche.
    const t = b.dataset.tool as Tool;
    editor.setTool(editor.tool === t ? 'select' : t);
  }));
$('[data-undo]').addEventListener('click', () => editor.undo());
$('[data-redo]').addEventListener('click', () => editor.redo());
$('[data-zoom-in]').addEventListener('click', () => editor.zoomBy(1.25));
$('[data-zoom-out]').addEventListener('click', () => editor.zoomBy(0.8));
$('[data-zoom-fit]').addEventListener('click', () => editor.fit());
$('[data-zoom-label]').addEventListener('click', () => editor.actualSize());
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.view as View)));
function setView(v: View) {
  editor.setView(v);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('[data-compare-labels]').hidden = v !== 'compare';
}

// Panneau en « tiroir » sur téléphone.
const sheetToggle = $<HTMLButtonElement>('[data-sheet-toggle]');
function openSheet() { document.body.classList.add('sheet-open'); sheetToggle.setAttribute('aria-expanded', 'true'); }
sheetToggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('sheet-open');
  sheetToggle.setAttribute('aria-expanded', String(open));
});

// ————— Raccourcis clavier —————
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// Champs où l'on tape du texte : Ctrl+Z y annule la frappe. Ailleurs (nombre, curseur, couleur, case…), c'est l'éditeur.
const textEntry = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && /^(text|search|password|email|url)$/.test(t.type)));
window.addEventListener('keydown', (e) => {
  if (screens.editor.hidden || $<HTMLDialogElement>('[data-publish-dialog]').open) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z' && !textEntry(e.target)) { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
  if (mod && k === 'y' && !textEntry(e.target)) { e.preventDefault(); editor.redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveNow(); return; }
  if (typing(e.target)) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
  if (mod && k === 'd') { e.preventDefault(); editor.duplicate(); return; }
  if (mod) return;
  const step = (e.shiftKey ? 10 : 1) * Math.max(1, Math.round(1 / editor.stage.scaleX()));
  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); editor.remove(); break;
    case 'Escape': editor.select(null); editor.setTool('select'); break;
    case 'Enter': if (editor.getSelected()) { e.preventDefault(); openSheet(); panel.focusText(); } break;
    case 'ArrowLeft': e.preventDefault(); editor.nudge(-step, 0); break;
    case 'ArrowRight': e.preventDefault(); editor.nudge(step, 0); break;
    case 'ArrowUp': e.preventDefault(); editor.nudge(0, -step); break;
    case 'ArrowDown': e.preventDefault(); editor.nudge(0, step); break;
    case '+': case '=': editor.zoomBy(1.25); break;
    case '-': editor.zoomBy(0.8); break;
    case '0': editor.fit(); break;
    case '1': editor.actualSize(); break;
    default: {
      const tools: Record<string, Tool> = { v: 'select', t: 'text', e: 'label', b: 'bubble-oval', r: 'bubble-rect', p: 'bubble-thought', a: 'arrow', f: 'marker', s: 'pen' };
      if (tools[k]) editor.setTool(tools[k]);
    }
  }
});

// ————— Sauvegarde locale —————
const saveState = $('[data-save-state]');
let saveTimer = 0, thumbAt = 0;
function scheduleSave() {
  saveState.textContent = 'Modifications…';
  saveState.dataset.state = 'pending';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!current) return;
  try {
    current.doc = editor.doc;
    current.updatedAt = Date.now();
    if (Date.now() - thumbAt > 4000) {
      current.thumb = editor.renderFinal(360).toDataURL('image/jpeg', 0.8);
      thumbAt = Date.now();
    }
    await putProject(current);
    saveState.textContent = 'Brouillon enregistré ✓';
    saveState.dataset.state = 'ok';
  } catch (err) {
    console.error(err);
    saveState.textContent = '⚠ Non enregistré';
    saveState.title = 'Le stockage du navigateur est indisponible : le brouillon n’a pas pu être gardé.';
    saveState.dataset.state = 'error';
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && current) saveNow(); });

const nameInput = $<HTMLInputElement>('[data-name]');
nameInput.addEventListener('change', async () => {
  if (!current) return;
  current.name = nameInput.value.trim() || 'Sans titre';
  await saveNow();
  if (current.book) for (const p of await bookPages(current.book.id)) if (p.id !== current.id) { p.name = current.name; await putProject(p); }
});

// ————— Ouverture / création —————
async function decode(blob: Blob, w?: number, h?: number) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const srcW = bmp.width, srcH = bmp.height;
  let W = w ?? srcW, H = h ?? srcH;
  let reduced = false;
  if (!w && W * H > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (W * H));
    W = Math.floor(W * k); H = Math.floor(H * k); reduced = true;
  }
  const orig = document.createElement('canvas');
  orig.width = W; orig.height = H;
  const ctx = orig.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); // PNG transparents : fond papier
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, W, H);
  const paper = paperColor(data);
  const clean = document.createElement('canvas');
  clean.width = W; clean.height = H;
  clean.getContext('2d')!.putImageData(cleanImageData(data), 0, 0);
  return { orig, clean, W, H, reduced, srcW, srcH, paper };
}

/** Couleur moyenne du papier de l'original (pixels les plus clairs). */
function paperColor(im: ImageData) {
  const d = im.data, n = im.width * im.height;
  const step = Math.max(1, Math.floor(n / 60000));
  const px: [number, number, number, number][] = [];
  for (let p = 0; p < n; p += step) { const i = p * 4; px.push([(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000, d[i], d[i + 1], d[i + 2]]); }
  px.sort((a, b) => a[0] - b[0]);
  const top = px.slice(Math.floor(px.length * 0.5), Math.floor(px.length * 0.9));
  const avg = (k: 1 | 2 | 3) => Math.round(top.reduce((s, x) => s + x[k], 0) / Math.max(1, top.length));
  return '#' + [avg(1), avg(2), avg(3)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function loadFonts() {
  const loads: Promise<unknown>[] = [];
  for (const f of Object.values(FONTS)) for (const w of f.weights) loads.push(document.fonts.load(`${w} 40px "${f.family}"`, 'AÉàçœ'));
  await Promise.allSettled(loads);
}

async function openProject(rec: ProjectRecord) {
  setBusy('Préparation du dessin…');
  await nextFrame();
  try {
    const blob = await getOriginal(rec.id);
    if (!blob) throw new Error('Le fichier original de ce brouillon est introuvable sur cet appareil.');
    const [{ orig, clean, paper }] = await Promise.all([decode(blob, rec.width, rec.height), loadFonts()]);
    current = rec;
    nameInput.value = rec.name;
    originalInfo = `${(blob.size / 1e6).toFixed(1).replace('.', ',')} Mo`;
    show('editor');
    await nextFrame();
    editor.load(rec.doc as Doc, orig, clean, paper);
    editor.refreshFonts();
    setView(editor.view);
    panel.tab = 'layers';
    panel.render();
    saveState.textContent = 'Brouillon enregistré ✓';
    saveState.dataset.state = 'ok';
    history.replaceState(null, '', `?projet=${rec.id}`);
    await renderPageBar();
  } catch (err) {
    alert((err as Error).message);
    goHome();
  } finally { setBusy(null); }
}

async function createFromBlob(blob: Blob, name: string, folder: string | null = null, slot: Slot = 'planche') {
  if (!/^image\//.test(blob.type) && blob.type) throw new Error('Ce fichier n’est pas une image.');
  setBusy('Import du dessin…');
  await nextFrame();
  try {
    const { W, H, reduced, srcW, srcH } = await decode(blob);
    const now = Date.now();
    const rec: ProjectRecord = { id: uid(), name, createdAt: now, updatedAt: now, width: W, height: H, doc: newDoc(W, H), folder, slot };
    await putOriginal(rec.id, blob); // fichier d'origine, intact
    await putProject(rec);
    askPersistence();
    if (reduced) alert(`Ce dessin fait ${srcW} × ${srcH} pixels, trop grand pour l’éditeur du navigateur. Il est édité en ${W} × ${H}. Le fichier original reste intact.`);
    await openProject(rec);
  } finally { setBusy(null); }
}

/** Taille d'édition d'une image (réduite au-delà de la limite des canevas). */
async function measure(blob: Blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const srcW = bmp.width, srcH = bmp.height;
  bmp.close?.();
  const k = srcW * srcH > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (srcW * srcH)) : 1;
  return { W: Math.floor(srcW * k), H: Math.floor(srcH * k) };
}

/** Dessin à plusieurs pages : un brouillon par page, reliés par book.id ; ouvre la page 1 (ou `open`). */
async function createBook(blobs: Blob[], name: string, folder: string | null = null, bookId = uid(), firstIndex = 0, open = 0) {
  if (firstIndex + blobs.length > MAX_PAGES) throw new Error(`${MAX_PAGES} pages au maximum par dessin.`);
  const made: ProjectRecord[] = [];
  for (let i = 0; i < blobs.length; i++) {
    setBusy(`Préparation de la page ${firstIndex + i + 1}…`);
    await nextFrame();
    const { W, H } = await measure(blobs[i]);
    const now = Date.now();
    const rec: ProjectRecord = {
      id: uid(), name, createdAt: now, updatedAt: now, width: W, height: H, doc: newDoc(W, H), folder, slot: 'planche',
      book: { id: bookId, index: firstIndex + i },
    };
    await putOriginal(rec.id, blobs[i]);
    await putProject(rec);
    made.push(rec);
  }
  askPersistence();
  await openProject(made[open] ?? made[0]);
}

/** Import : une image → un dessin ; un PDF ou plusieurs images → un dessin à pages. */
async function importFiles(files: File[]) {
  if (!files.length) return;
  try {
    const pdfs = files.filter(isPdf);
    if (pdfs.length > 1 || (pdfs.length && files.length > 1)) throw new Error('Importe un seul PDF à la fois (ou seulement des images).');
    let blobs: Blob[] = files;
    if (pdfs.length) {
      setBusy('Lecture du PDF…');
      blobs = await pdfToImages(pdfs[0], (i, n) => setBusy(`Lecture du PDF : page ${i} sur ${n}…`));
      if (!blobs.length) throw new Error('Ce PDF n’a aucune page.');
    } else if (files.some((f) => f.type && !/^image\//.test(f.type))) {
      throw new Error('Choisis des images ou un PDF.');
    }
    const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') || 'Sans titre' : `Dessin à ${files.length} pages`;
    if (blobs.length === 1) await createFromBlob(blobs[0], name);
    else await createBook(blobs, name);
  } catch (err) { alert((err as Error).message || 'Impossible de lire ce fichier.'); }
  finally { setBusy(null); }
}

// ————— Pages d'un dessin —————
const pageBar = $('[data-pagebar]');
const pageSel = $<HTMLSelectElement>('[data-page-select]');
let pages: ProjectRecord[] = [];
async function renderPageBar() {
  pages = current?.book ? await bookPages(current.book.id) : [];
  pageBar.hidden = !current;
  const i = pages.findIndex((p) => p.id === current?.id);
  pageSel.replaceChildren(...pages.map((p, k) => new Option(`Page ${k + 1} / ${pages.length}`, p.id)));
  if (!pages.length) pageSel.append(new Option('Page unique', ''));
  pageSel.value = current?.id && pages.length ? current.id : '';
  pageSel.disabled = pages.length < 2;
  $<HTMLButtonElement>('[data-page-prev]').disabled = i <= 0;
  $<HTMLButtonElement>('[data-page-next]').disabled = i < 0 || i >= pages.length - 1;
  $<HTMLButtonElement>('[data-page-remove]').hidden = pages.length < 2;
}
async function goToPage(id: string) {
  if (!current || id === current.id) return;
  await saveNow();
  const rec = await getProject(id);
  if (rec) await openProject(rec);
}
pageSel.addEventListener('change', () => goToPage(pageSel.value));
$('[data-page-prev]').addEventListener('click', () => { const i = pages.findIndex((p) => p.id === current?.id); if (i > 0) goToPage(pages[i - 1].id); });
$('[data-page-next]').addEventListener('click', () => { const i = pages.findIndex((p) => p.id === current?.id); if (i >= 0 && i < pages.length - 1) goToPage(pages[i + 1].id); });
$<HTMLInputElement>('[data-page-add]').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!current || !files.length) return;
  try {
    await saveNow();
    let blobs: Blob[] = files;
    if (files.some(isPdf)) {
      if (files.length > 1) throw new Error('Ajoute un seul PDF à la fois.');
      blobs = await pdfToImages(files[0], (i, n) => setBusy(`Lecture du PDF : page ${i} sur ${n}…`));
    }
    // Un dessin d'une seule page devient un dessin à pages.
    if (!current.book) { current.book = { id: uid(), index: 0 }; await putProject(current); }
    const all = await bookPages(current.book.id);
    await createBook(blobs, current.name, current.folder ?? null, current.book.id, all.length, 0);
  } catch (err) { alert((err as Error).message); }
  finally { setBusy(null); }
});
$('[data-page-remove]').addEventListener('click', async () => {
  if (!current?.book || pages.length < 2) return;
  const i = pages.findIndex((p) => p.id === current!.id);
  if (!confirm(`Retirer la page ${i + 1} de ce dessin ? Elle sera supprimée de cet appareil.`)) return;
  const gone = current;
  current = null;
  await deleteProject(gone.id);
  const rest = pages.filter((p) => p.id !== gone.id);
  for (let k = 0; k < rest.length; k++) { rest[k].book = { id: gone.book!.id, index: k }; await putProject(rest[k]); }
  await openProject(rest[Math.min(i, rest.length - 1)]);
});

// Feuille blanche : un « original » blanc, puis on dessine au stylo.
const SHEETS: Record<string, [number, number, string]> = {
  portrait: [2480, 3508, 'A4 portrait'], paysage: [3508, 2480, 'A4 paysage'], carre: [2480, 2480, 'Carré'],
};
document.querySelectorAll<HTMLButtonElement>('[data-blank]').forEach((b) => b.addEventListener('click', async () => {
  const [w, h, label] = SHEETS[b.dataset.blank!];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) { alert('Impossible de créer la feuille.'); return; }
  try {
    await createFromBlob(blob, `Dessin — ${label}`);
    editor.setTool('pen');
  } catch (err) { alert((err as Error).message); }
}));

$<HTMLInputElement>('[data-import]').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  await importFiles(files);
});
const drop = $('[data-drop]');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  await importFiles([...(e.dataTransfer?.files ?? [])]);
});

// ————— Écran des brouillons —————
async function renderHome() {
  const list = $('[data-projects]');
  list.replaceChildren();
  let projects: ProjectRecord[] = [];
  try { projects = await listProjects(); }
  catch { list.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Le stockage local du navigateur est indisponible (navigation privée ?). Les brouillons ne pourront pas être gardés.' })); }
  const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  // Un dessin à plusieurs pages n'apparaît qu'une fois (sa page 1), avec le nombre de pages.
  const books = new Map<string, ProjectRecord[]>();
  for (const p of projects) if (p.book) books.set(p.book.id, [...(books.get(p.book.id) ?? []), p]);
  for (const list of books.values()) list.sort((a, b) => a.book!.index - b.book!.index);
  const shown = projects.filter((p) => !p.book || books.get(p.book.id)![0] === p);
  $('[data-no-projects]').hidden = shown.length > 0;
  for (const p of shown) {
    const group = p.book ? books.get(p.book.id)! : [p];
    const last = Math.max(...group.map((x) => x.updatedAt));
    const li = document.createElement('li');
    li.className = 'proj';
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'proj-open';
    const img = document.createElement(p.thumb ? 'img' : 'span') as HTMLImageElement;
    img.className = 'proj-thumb';
    if (p.thumb) { img.src = p.thumb; img.alt = ''; }
    const t = document.createElement('span'); t.className = 'proj-t';
    const name = document.createElement('strong'); name.textContent = p.name;
    const meta = document.createElement('span'); meta.className = 'meta';
    const target = p.folder ? specs.find((s) => s.folder === p.folder) : null;
    meta.textContent = `${fmt.format(last)} · ${group.length > 1 ? `${group.length} pages` : `${p.width} × ${p.height}`}${target ? ` · spécimen n°${target.n}` : ''}`;
    t.append(name, meta);
    open.append(img, t);
    open.addEventListener('click', () => openProject(p));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'linkish danger'; del.textContent = 'supprimer';
    del.addEventListener('click', async () => {
      if (!confirm(group.length > 1 ? `Supprimer le dessin « ${p.name} » et ses ${group.length} pages de cet appareil ?` : `Supprimer le brouillon « ${p.name} » de cet appareil ?`)) return;
      for (const x of group) await deleteProject(x.id);
      renderHome();
    });
    li.append(open, del);
    list.append(li);
  }
}

function goHome() {
  if (current) saveNow();
  current = null;
  history.replaceState(null, '', location.pathname);
  show('home');
  renderHome();
}
$('[data-home]').addEventListener('click', goHome);

// ————— Export et publication —————
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export impossible'))), type, q));
const blobToBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
const mo = (n: number) => `${(n / 1e6).toFixed(1).replace('.', ',')} Mo`;
const fileName = () => (current?.name || 'planche').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'planche';

async function finalCanvas() {
  await loadFonts();
  return editor.renderFinal();
}

$('[data-download]').addEventListener('click', async () => {
  setBusy('Préparation du PNG…');
  await nextFrame();
  try {
    const blob = await toBlob(await finalCanvas(), 'image/png');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${fileName()}.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (err) { alert((err as Error).message); }
  finally { setBusy(null); }
});

/** PNG sans perte si possible ; sinon JPEG haute qualité, puis réduction (limite d'envoi). */
async function encodeForUpload(c: HTMLCanvasElement) {
  const png = await toBlob(c, 'image/png');
  if (bigUploads && png.size < BIG_LIMIT) return { blob: png, ext: 'png' as const, canvas: c, note: `PNG sans perte, ${c.width} × ${c.height} px (${mo(png.size)}).` };
  if (png.size * 1.34 < UPLOAD_LIMIT) return { blob: png, ext: 'png' as const, canvas: c, note: `PNG sans perte, ${c.width} × ${c.height} px (${mo(png.size)}).` };
  for (const q of [0.95, 0.92, 0.88]) {
    const jpg = await toBlob(c, 'image/jpeg', q);
    if (jpg.size * 1.34 < UPLOAD_LIMIT) return { blob: jpg, ext: 'jpg' as const, canvas: c, note: `Le PNG (${mo(png.size)}) dépasse la limite d’envoi : JPEG qualité ${Math.round(q * 100)} %, ${c.width} × ${c.height} px (${mo(jpg.size)}). Le PNG complet reste téléchargeable.` };
  }
  let k = 0.85, small = c;
  for (let i = 0; i < 6; i++, k *= 0.85) {
    small = document.createElement('canvas');
    small.width = Math.round(c.width * k); small.height = Math.round(c.height * k);
    const ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, small.width, small.height);
    const jpg = await toBlob(small, 'image/jpeg', 0.92);
    if (jpg.size * 1.34 < UPLOAD_LIMIT) return { blob: jpg, ext: 'jpg' as const, canvas: small, note: `Image trop lourde pour l’envoi : réduite à ${small.width} × ${small.height} px en JPEG (${mo(jpg.size)}). Le PNG complet reste téléchargeable.` };
  }
  throw new Error('Image trop lourde pour être envoyée.');
}

const dlg = $<HTMLDialogElement>('[data-publish-dialog]');
const destSel = $<HTMLSelectElement>('[data-dest]');
const slotSel = $<HTMLSelectElement>('[data-slot]');
let prepared: Awaited<ReturnType<typeof encodeForUpload>> | null = null;
let preparedPages: Awaited<ReturnType<typeof encodeForUpload>>[] = []; // pages 2, 3… d'un dessin à pages

// Éditeur invisible pour rendre les autres pages sans quitter celle qu'on retouche.
let renderer: Editor | null = null;
function pageRenderer() {
  if (!renderer) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:200px;overflow:hidden;';
    box.setAttribute('aria-hidden', 'true');
    document.body.append(box);
    const noop = () => {};
    renderer = new Editor(box as HTMLDivElement, { change: noop, select: noop, tool: noop, zoom: noop, history: noop, editText: noop });
  }
  return renderer;
}
async function renderPage(rec: ProjectRecord) {
  const blob = await getOriginal(rec.id);
  if (!blob) throw new Error(`Le fichier original de la page « ${rec.name} » est introuvable sur cet appareil.`);
  const { orig, clean, paper } = await decode(blob, rec.width, rec.height);
  const r = pageRenderer();
  r.load(rec.doc as Doc, orig, clean, paper);
  r.refreshFonts();
  await loadFonts();
  return r.renderFinal();
}
let previewUrl = '';

for (const s of specs) destSel.append(new Option(`Spécimen n°${s.n} — ${s.title}`, s.folder));

$('[data-publish]').addEventListener('click', async () => {
  if (!current) return;
  await saveNow();
  setBusy('Préparation de l’image finale…');
  await nextFrame();
  try {
    // Dessin à pages : on publie toutes les pages, dans l'ordre (la page 1 devient la planche).
    const all = current.book ? await bookPages(current.book.id) : [current];
    const results = [];
    for (let i = 0; i < all.length; i++) {
      if (all.length > 1) { setBusy(`Préparation de la page ${i + 1} sur ${all.length}…`); await nextFrame(); }
      const c = all[i].id === current.id ? await finalCanvas() : await renderPage(all[i]);
      results.push(await encodeForUpload(c));
    }
    prepared = results[0];
    preparedPages = results.slice(1);
    URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(prepared.blob);
    $<HTMLImageElement>('[data-preview]').src = previewUrl;
    $('[data-preview-info]').textContent = preparedPages.length
      ? `Dessin de ${results.length} pages : toutes seront publiées, dans l’ordre (aperçu de la page 1). Page 1 : ${prepared.note}`
      : prepared.note;
    slotSel.disabled = preparedPages.length > 0; // un dessin à pages se publie comme planche
    destSel.value = current.folder && specs.some((s) => s.folder === current!.folder) ? current.folder : '';
    slotSel.value = preparedPages.length ? 'planche' : current.slot ?? 'planche';
    dlg.showModal();
  } catch (err) { alert((err as Error).message); }
  finally { setBusy(null); }
});
$('[data-dialog-close]').addEventListener('click', () => dlg.close());
$('[data-dialog-download]').addEventListener('click', () => $<HTMLButtonElement>('[data-download]').click());
$('[data-send]').addEventListener('click', async () => {
  if (!current || !prepared) return;
  const btn = $<HTMLButtonElement>('[data-send]');
  btn.disabled = true;
  try {
    current.folder = destSel.value || null;
    current.slot = slotSel.value as Slot;
    await saveNow();
    if (current.book) for (const p of await bookPages(current.book.id)) if (p.id !== current.id) { p.folder = current.folder; await putProject(p); }
    await setHandoff({
      projectId: current.id, base64: await blobToBase64(prepared.blob), ext: prepared.ext,
      width: prepared.canvas.width, height: prepared.canvas.height,
      slot: current.slot, folder: current.folder, createdAt: Date.now(),
      pages: await Promise.all(preparedPages.map(async (p): Promise<HandoffPage> => ({
        base64: await blobToBase64(p.blob), ext: p.ext, width: p.canvas.width, height: p.canvas.height,
      }))),
    });
    location.href = '/admin?studio=1';
  } catch (err) { alert((err as Error).message); btn.disabled = false; }
});

// ————— Démarrage —————
async function start() {
  show('home');
  await renderHome();
  const q = new URLSearchParams(location.search);
  const pid = q.get('projet');
  const from = q.get('from');
  if (pid) {
    const rec = await getProject(pid).catch(() => undefined);
    if (rec) return openProject(rec);
  }
  if (from) {
    const spec = specs.find((s) => s.folder === from);
    const slot = (q.get('slot') === 'espece' ? 'espece' : 'planche') as Slot;
    const url = spec?.orig[slot];
    if (spec && url) {
      try {
        setBusy('Chargement du dessin publié…');
        const urls = slot === 'planche' ? [url, ...spec.orig.pages] : [url];
        const blobs = [];
        for (const u of urls) {
          const res = await fetch(u);
          if (!res.ok) throw new Error(`Image introuvable (${res.status}).`);
          blobs.push(await res.blob());
        }
        const name = `Spécimen n°${spec.n} — ${spec.title}`;
        if (blobs.length > 1) await createBook(blobs, name, spec.folder);
        else await createFromBlob(blobs[0], name, spec.folder, slot);
      } catch (err) { alert((err as Error).message); }
      finally { setBusy(null); }
    }
  }
}

if (code) checkCode(code).then(start, () => show('login'));
else show('login');
