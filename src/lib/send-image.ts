// Envoi d'une image vers GitHub depuis le navigateur (admin).
// - Vercel Blob branché : dépôt direct dans l'espace privé (jusqu'à 40 Mo), puis le serveur la range dans GitHub.
// - Sinon : envoi classique en base64 à travers la fonction (≈ 3 Mo au maximum).
import { upload, uploadPresigned } from '@vercel/blob/client';

export type Ext = 'png' | 'jpg' | 'webp';
export const SMALL_LIMIT = 4_200_000; // base64 (limite d'une requête Vercel : 4,5 Mo)
export const BIG_LIMIT = 40 * 1024 * 1024; // octets, avec Vercel Blob

const extOf = (type: string): Ext => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');
const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});

interface Opts {
  code: string;
  big: boolean;
  /** Mode de l'espace Blob annoncé par le serveur à la connexion. */
  mode?: 'token' | 'oidc' | null;
  name: string; // ex. « planche », « page-2 »
  api: (body: object) => Promise<any>;
}

/** Envoie l'image et renvoie son identifiant GitHub (sha) et son format réel. */
export async function sendImage(data: Blob, { code, big, name, api, mode }: Opts): Promise<{ sha: string; ext: Ext }> {
  const ext = extOf(data.type);
  if (big) {
    try { return await sendBig(data, ext, { code, name, api, mode }); }
    catch (err) {
      // Blob indisponible : on repasse par l'envoi classique si l'image y tient.
      if (data.size * 1.34 > SMALL_LIMIT) throw err;
      console.warn('Envoi par Vercel Blob impossible, envoi classique :', err);
    }
  }
  const base64 = await toBase64(data);
  if (base64.length > SMALL_LIMIT) throw new Error(`Image « ${name} » trop lourde pour l’envoi (≈ 3 Mo au maximum sans Vercel Blob).`);
  const r = await api({ action: 'blob', base64 });
  return { sha: r.sha, ext };
}

async function sendBig(data: Blob, ext: Ext, { code, name, api, mode }: Omit<Opts, 'big'>) {
  if (data.size > BIG_LIMIT) throw new Error(`Image « ${name} » trop lourde (40 Mo au maximum).`);
  const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'image';
  const common = {
    access: 'private' as const,
    handleUploadUrl: '/api/upload',
    headers: { 'x-admin-code': code },
    contentType: data.type || 'image/jpeg',
    multipart: data.size > 25 * 1024 * 1024, // découpage en morceaux seulement pour les très gros fichiers
  };
  // En OIDC, l'adresse pré-signée vaut pour un nom précis : on rend le nom unique ici.
  const r = mode === 'oidc'
    ? await uploadPresigned(`uploads/${safe}-${crypto.randomUUID().slice(0, 12)}.${ext}`, data, common)
    : await upload(`uploads/${safe}.${ext}`, data, common);
  const s = await api({ action: 'blob-from-store', url: r.url });
  return { sha: s.sha as string, ext: s.ext as Ext };
}

/** Image d'une adresse data:… ou blob:… en objet Blob. */
export const urlToBlob = async (url: string) => (await fetch(url)).blob();
