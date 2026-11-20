// Autorise le navigateur à déposer une image dans l'espace privé Vercel Blob (dossier uploads/).
// Seulement avec le code de l'admin ; la clé de l'espace reste sur le serveur.
// - clé fixe (BLOB_READ_WRITE_TOKEN) : jeton d'envoi signé ici (handleUpload) ;
// - OIDC (BLOB_STORE_ID, réglage par défaut de Vercel) : jeton limité à ce seul fichier demandé à Vercel,
//   puis adresse d'envoi pré-signée (handleUploadPresigned).
import type { APIRoute } from 'astro';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { codeOk } from '../../lib/auth';
import { blobAuth, blobMode, MAX_UPLOAD, UPLOAD_PREFIX } from '../../lib/blob-store';

export const prerender = false;

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function checkPath(pathname: string) {
  if (!/^uploads\/[a-z0-9._-]{1,80}$/i.test(pathname) || !pathname.startsWith(UPLOAD_PREFIX)) throw new Error('Nom de fichier refusé.');
}

export const POST: APIRoute = async ({ request }) => {
  if (!codeOk(request.headers.get('x-admin-code'))) return json(401, { error: 'Code d’accès incorrect.' });
  const mode = blobMode();
  if (!mode) return json(501, { error: 'Vercel Blob n’est pas branché sur ce site.' });
  const body = (await request.json().catch(() => null)) as any;
  if (!body) return json(400, { error: 'Requête invalide.' });
  const validUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
  try {
    if (mode === 'token') {
      return json(200, await handleUpload({
        body, request,
        onBeforeGenerateToken: async (pathname) => {
          checkPath(pathname);
          return { allowedContentTypes: TYPES, maximumSizeInBytes: MAX_UPLOAD, addRandomSuffix: true, validUntil };
        },
      }));
    }
    return json(200, await handleUploadPresigned({
      body, request,
      getSignedToken: async (pathname) => {
        checkPath(pathname);
        const token = await issueSignedToken({
          pathname, operations: ['put'], validUntil, maximumSizeInBytes: MAX_UPLOAD, allowedContentTypes: TYPES, ...blobAuth(request),
        });
        return { token };
      },
    }));
  } catch (e) {
    return json(400, { error: (e as Error).message });
  }
};
