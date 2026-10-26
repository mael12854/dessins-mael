import type { APIRoute } from 'astro';
import { createHash, timingSafeEqual } from 'node:crypto';
import { commit, createBlob, listDir, readText, HttpError, type Change } from '../../lib/github';
import seriesData from '../../data/series.json';
import { readPage, readZone } from '../../lib/handwriting';

export const prerender = false;

const SPEC_DIR = 'specimens';
const IMG_KEYS = ['planche', 'espece', 'signature'] as const;
type ImgKey = (typeof IMG_KEYS)[number];
const MAX_BLOB = 4_200_000; // base64, ~3,1 Mo d'image (limite d'une requête Vercel : 4,5 Mo)

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const sha = (s: string) => createHash('sha256').update(s).digest();
function codeOk(given: string | null) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !given) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

const pad = (n: number) => String(n).padStart(3, '0');
const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const q = (s: string) => JSON.stringify(s); // chaîne YAML entre guillemets
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const folderOk = (f: unknown): f is string => typeof f === 'string' && /^[a-z0-9-]+$/.test(f);
const blobOk = (b: unknown): b is string => typeof b === 'string' && /^[0-9a-f]{40}$/.test(b);
const extOk = (e: unknown): e is string => typeof e === 'string' && /^(jpg|png|webp)$/.test(e);

interface ImgIn { blob?: string; ext?: string; remove?: boolean }

function buildMarkdown(d: any, img: Record<ImgKey, string | null>): string {
  const L = ['---', `n: ${d.n}`, `series: ${d.series}`, `tech: ${d.tech}`, `title: ${q(d.title)}`];
  if (d.latin) L.push(`latin: ${q(d.latin)}`);
  L.push(`date: ${q(d.date)}`, `lieu: ${q(d.lieu)}`);
  if (img.planche) L.push(`image: ./${img.planche}`);
  if (img.planche && d.alt) L.push(`alt: ${q(d.alt)}`);
  if (d.texte) L.push(`texte: ${q(d.texte)}`);
  if (img.signature) L.push(`signature: ./${img.signature}`);
  if (d.pending) L.push('pending: true');
  if (d.fiche) {
    const f = d.fiche;
    L.push('fiche:');
    if (img.espece) L.push(`  image: ./${img.espece}`);
    if (img.espece && f.alt) L.push(`  alt: ${q(f.alt)}`);
    L.push(`  habitat: ${q(f.habitat)}`, `  cri: ${q(f.cri)}`, `  rush: ${q(f.rush)}`, `  crush: ${q(f.crush)}`);
    if (f.annotations.length) {
      L.push('  annotations:');
      for (const a of f.annotations) L.push(`    - { text: ${q(a.text)}, x: ${a.x}, y: ${a.y} }`);
    }
  }
  L.push('---', '');
  return L.join('\n');
}

function validate(raw: any) {
  const d: any = {
    n: Number(raw?.n),
    series: typeof raw?.series === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.series) ? raw.series : '',
    tech: ['feutre', 'numerique', 'mixte'].includes(raw?.tech) ? raw.tech : 'feutre',
    title: str(raw?.title, 120),
    latin: str(raw?.latin, 120),
    date: str(raw?.date, 10),
    lieu: str(raw?.lieu, 120),
    alt: str(raw?.alt, 400),
    texte: str(raw?.texte, 4000),
    pending: !!raw?.pending,
  };
  if (!d.series) throw new HttpError(400, 'Série invalide.');
  if (!Number.isInteger(d.n) || d.n < 1 || d.n > 9999) throw new HttpError(400, 'Numéro invalide.');
  if (!d.title) throw new HttpError(400, 'Le titre est obligatoire.');
  if (!d.lieu) throw new HttpError(400, 'Le lieu est obligatoire.');
  if (d.pending && !d.date) d.date = '—';
  if (!/^(\d{2}\.\d{2}\.\d{4}|—)$/.test(d.date)) throw new HttpError(400, 'Date invalide (JJ.MM.AAAA).');
  if (raw?.fiche) {
    const f = raw.fiche;
    d.fiche = {
      alt: str(f.alt, 400),
      habitat: str(f.habitat), cri: str(f.cri), rush: str(f.rush), crush: str(f.crush),
      annotations: (Array.isArray(f.annotations) ? f.annotations : [])
        .slice(0, 4)
        .map((a: any) => ({ text: str(a?.text, 60), x: Math.round(Math.min(100, Math.max(0, Number(a?.x) || 0))), y: Math.round(Math.min(100, Math.max(0, Number(a?.y) || 0))) }))
        .filter((a: any) => a.text),
    };
    for (const k of ['habitat', 'cri', 'rush', 'crush']) if (!d.fiche[k]) throw new HttpError(400, `Fiche espèce : la rubrique « ${k} » est vide.`);
  }
  return d;
}

async function save(body: any) {
  const d = validate(body.data);
  const original = body.original;
  if (original !== undefined && original !== null && !folderOk(original)) throw new HttpError(400, 'Dossier invalide.');

  const all = await listDir(SPEC_DIR);
  const dirs = all.filter((e) => e.type === 'dir');
  const taken = dirs.find((e) => e.name.startsWith(pad(d.n) + '-') && e.name !== original);
  if (taken) throw new HttpError(409, `Le numéro ${d.n} est déjà utilisé (${taken.name}).`);

  const folder = original || `${pad(d.n)}-${slug(d.title) || 'specimen'}`;
  const existing = original ? await listDir(`${SPEC_DIR}/${folder}`) : [];
  if (original && !existing.length) throw new HttpError(404, 'Ce spécimen n’existe plus.');

  const changes: Change[] = [];
  const img = {} as Record<ImgKey, string | null>;
  const imgs: Record<string, ImgIn> = body.images || {};
  for (const k of IMG_KEYS) {
    const cur = existing.find((e) => e.type === 'file' && e.name.startsWith(k + '.'));
    // Sans fiche, le dessin de l'espèce est retiré.
    const inc: ImgIn = k === 'espece' && !d.fiche ? { remove: true } : imgs[k] || {};
    if (inc.blob) {
      if (!blobOk(inc.blob) || !extOk(inc.ext)) throw new HttpError(400, 'Image invalide.');
      const name = `${k}.${inc.ext}`;
      if (cur && cur.name !== name) changes.push({ path: cur.path, delete: true });
      changes.push({ path: `${SPEC_DIR}/${folder}/${name}`, blob: inc.blob });
      img[k] = name;
    } else if (inc.remove && cur) {
      changes.push({ path: cur.path, delete: true });
      img[k] = null;
    } else {
      img[k] = cur ? cur.name : null;
    }
  }

  const unique = [...changes];
  unique.push({ path: `${SPEC_DIR}/${folder}/index.md`, content: buildMarkdown(d, img) });
  const verb = original ? 'modifie' : 'ajoute';
  const sha = await commit(`Admin : ${verb} le spécimen n°${d.n} — ${d.title}`, unique);
  return { ok: true, folder, commit: sha };
}

async function saveSeries(body: any) {
  const raw = Array.isArray(body.series) ? body.series : [];
  if (!raw.length || raw.length > 30) throw new HttpError(400, 'Liste de séries invalide.');
  const list = raw.map((x: any) => ({ id: String(x?.id ?? ''), label: str(x?.label, 60), fiche: !!x?.fiche }));
  const ids = new Set<string>();
  for (const x of list) {
    if (!/^[a-z0-9-]{1,40}$/.test(x.id) || ids.has(x.id)) throw new HttpError(400, `Identifiant de série invalide : ${x.id}`);
    if (!x.label) throw new HttpError(400, 'Chaque série doit avoir un nom.');
    ids.add(x.id);
  }
  // Une série encore utilisée par un spécimen ne peut pas disparaître.
  const current: { id: string }[] = JSON.parse((await readText('src/data/series.json')) ?? JSON.stringify(seriesData));
  const removed = current.map((x) => x.id).filter((id) => !ids.has(id));
  if (removed.length) {
    const dirs = (await listDir(SPEC_DIR)).filter((e) => e.type === 'dir');
    for (const dir of dirs) {
      const md = await readText(`${SPEC_DIR}/${dir.name}/index.md`);
      const used = md?.match(/^series:\s*"?([a-z0-9-]+)"?\s*$/m)?.[1];
      if (used && removed.includes(used)) throw new HttpError(409, `La série « ${used} » contient encore le spécimen ${dir.name}.`);
    }
  }
  const sha = await commit('Admin : met à jour les séries', [{ path: 'src/data/series.json', content: JSON.stringify(list, null, 2) + '\n' }]);
  return { ok: true, commit: sha };
}

async function remove(body: any) {
  if (!folderOk(body.folder)) throw new HttpError(400, 'Dossier invalide.');
  const files = await listDir(`${SPEC_DIR}/${body.folder}`);
  if (!files.length) throw new HttpError(404, 'Ce spécimen n’existe plus.');
  const changes: Change[] = files.filter((f) => f.type === 'file').map((f) => ({ path: f.path, delete: true }));
  const sha = await commit(`Admin : supprime le spécimen ${body.folder}`, changes);
  return { ok: true, commit: sha };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!codeOk(request.headers.get('x-admin-code'))) {
      await new Promise((r) => setTimeout(r, 800)); // freine les essais au hasard
      return json(401, { error: 'Code d’accès incorrect.' });
    }
    const body = await request.json().catch(() => null);
    if (!body) return json(400, { error: 'Requête invalide.' });
    switch (body.action) {
      case 'login':
        return json(200, { ok: true, github: !!process.env.GITHUB_TOKEN, ocr: !!process.env.ANTHROPIC_API_KEY });
      case 'ocr': {
        // Lecture de l'écriture : une zone (mode « zone ») ou toute la planche (mode « page »).
        const media = body.media === 'image/png' ? 'image/png' : 'image/jpeg';
        if (typeof body.base64 !== 'string' || body.base64.length > MAX_BLOB || !/^[A-Za-z0-9+/=]+$/.test(body.base64))
          return json(400, { error: 'Image trop lourde ou invalide.' });
        return json(200, body.mode === 'page' ? await readPage(body.base64, media) : await readZone(body.base64, media));
      }
      case 'blob': {
        if (typeof body.base64 !== 'string' || body.base64.length > MAX_BLOB || !/^[A-Za-z0-9+/=]+$/.test(body.base64))
          return json(400, { error: 'Image trop lourde ou invalide.' });
        return json(200, { sha: await createBlob(body.base64) });
      }
      case 'save':
        return json(200, await save(body));
      case 'series':
        return json(200, await saveSeries(body));
      case 'delete':
        return json(200, await remove(body));
      default:
        return json(400, { error: 'Action inconnue.' });
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Erreur inattendue.' });
  }
};
