// Envoi des grandes images par Vercel Blob (espace privé), côté serveur.
// Le navigateur dépose l'image dans uploads/ (sans passer par la fonction, donc sans la limite de 4,5 Mo),
// puis le serveur la relit, la range dans GitHub et l'efface de Blob.
import { del, get, list } from '@vercel/blob';
import { HttpError } from './github';

// Deux façons de relier l'espace au projet : clé fixe (BLOB_READ_WRITE_TOKEN) ou identifiants OIDC (BLOB_STORE_ID).
export const blobEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export const UPLOAD_PREFIX = 'uploads/';
export const MAX_UPLOAD = 40 * 1024 * 1024; // 40 Mo par image

/** Identifiant de l'espace : BLOB_STORE_ID (OIDC) ou lu dans la clé (vercel_blob_rw_<store>_…). */
const storeId = () =>
  (process.env.BLOB_STORE_ID?.replace(/^store_/, '') || (process.env.BLOB_READ_WRITE_TOKEN ?? '').split('_')[3] || '').toLowerCase();

/** L'adresse doit désigner un fichier uploads/ de NOTRE espace privé. */
function checkUrl(raw: unknown): URL {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new HttpError(400, 'Adresse d’image invalide.'); }
  const override = process.env.VERCEL_BLOB_API_URL; // faux service pour les tests uniquement
  const ours = override ? u.origin === new URL(override).origin : u.protocol === 'https:' && u.hostname === `${storeId()}.private.blob.vercel-storage.com`;
  if (!ours || !decodeURIComponent(u.pathname).startsWith('/' + UPLOAD_PREFIX)) throw new HttpError(400, 'Cette image ne vient pas de l’espace d’envoi du site.');
  return u;
}

/** Type réel de l'image d'après ses premiers octets. */
function sniff(b: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Relit une image déposée dans Blob, puis l'efface. Renvoie son contenu en base64. */
export async function takeUpload(rawUrl: unknown) {
  if (!blobEnabled()) throw new HttpError(501, 'Vercel Blob n’est pas branché sur ce site.');
  const url = checkUrl(rawUrl);
  const r = await get(url.toString(), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) throw new HttpError(404, 'Image introuvable dans l’espace d’envoi.');
  const chunks: Buffer[] = []; let size = 0;
  const reader = r.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD) throw new HttpError(413, 'Image trop lourde (40 Mo au maximum).');
    chunks.push(Buffer.from(value));
  }
  const buf = Buffer.concat(chunks);
  const ext = sniff(buf);
  await del(url.toString()).catch(() => {}); // l'image va dans GitHub : plus besoin de la garder ici
  if (!ext) throw new HttpError(400, 'Ce fichier n’est pas une image PNG, JPEG ou WebP.');
  return { base64: buf.toString('base64'), ext, size };
}

/** Efface les envois abandonnés (déposés il y a plus d'un jour). Sans effet si Blob n'est pas branché. */
export async function cleanOldUploads() {
  if (!blobEnabled()) return 0;
  const { blobs } = await list({ prefix: UPLOAD_PREFIX, limit: 100 });
  const old = blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > 24 * 3600 * 1000).map((b) => b.url);
  if (old.length) await del(old);
  return old.length;
}
