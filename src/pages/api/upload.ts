// Autorise le navigateur à déposer une image dans l'espace privé Vercel Blob (dossier uploads/).
// Seulement avec le code de l'admin ; la clé de l'espace reste sur le serveur.
import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { codeOk } from '../../lib/auth';
import { blobEnabled, MAX_UPLOAD, UPLOAD_PREFIX } from '../../lib/blob-store';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  if (!codeOk(request.headers.get('x-admin-code'))) return json(401, { error: 'Code d’accès incorrect.' });
  if (!blobEnabled()) return json(501, { error: 'Vercel Blob n’est pas branché sur ce site.' });
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return json(400, { error: 'Requête invalide.' });
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PREFIX) || !/^uploads\/[a-z0-9._-]{1,80}$/i.test(pathname)) throw new Error('Nom de fichier refusé.');
        return {
          allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'],
          maximumSizeInBytes: MAX_UPLOAD,
          addRandomSuffix: true,
          validUntil: Date.now() + 30 * 60 * 1000, // 30 minutes
        };
      },
    });
    return json(200, result);
  } catch (e) {
    return json(400, { error: (e as Error).message });
  }
};
