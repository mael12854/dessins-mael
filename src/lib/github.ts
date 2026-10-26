// Écriture dans le dépôt GitHub via l'API REST (un commit par enregistrement).
const API = process.env.GITHUB_API || 'https://api.github.com';

function cfg() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'mael12854/dessins-mael';
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new HttpError(500, 'GITHUB_TOKEN manquant dans les variables d’environnement Vercel.');
  return { token, repo, branch };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function gh<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { token, repo } = cfg();
  const res = await fetch(`${API}/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'specimens-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 404) return null as T;
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `GitHub a répondu ${res.status} : ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Envoie un fichier binaire (base64) et renvoie le SHA du blob. */
export async function createBlob(base64: string): Promise<string> {
  const r = await gh<{ sha: string }>('/git/blobs', { method: 'POST', body: JSON.stringify({ content: base64, encoding: 'base64' }) });
  return r.sha;
}

/** Liste les fichiers d'un dossier (un seul niveau). */
export async function listDir(path: string): Promise<{ name: string; path: string; type: string }[]> {
  const { branch } = cfg();
  const r = await gh<any[]>(`/contents/${encodeURI(path)}?ref=${branch}`);
  return Array.isArray(r) ? r : [];
}

/** Lit un fichier texte du dépôt (null s'il n'existe pas). */
export async function readText(path: string): Promise<string | null> {
  const { branch } = cfg();
  const r = await gh<{ content?: string; encoding?: string }>(`/contents/${encodeURI(path)}?ref=${branch}`);
  if (!r?.content) return null;
  return Buffer.from(r.content, 'base64').toString('utf8');
}

export type Change =
  | { path: string; content: string } // texte
  | { path: string; blob: string } // blob déjà envoyé
  | { path: string; delete: true };

/** Crée un commit avec toutes les modifications, puis avance la branche. */
export async function commit(message: string, changes: Change[]): Promise<string> {
  const { branch } = cfg();
  const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${branch}`);
  if (!ref) throw new HttpError(502, `Branche ${branch} introuvable.`);
  const parent = ref.object.sha;
  const parentCommit = await gh<{ tree: { sha: string } }>(`/git/commits/${parent}`);
  const tree = changes.map((c) => {
    const base = { path: c.path, mode: '100644', type: 'blob' };
    if ('delete' in c) return { ...base, sha: null };
    if ('blob' in c) return { ...base, sha: c.blob };
    return { ...base, content: c.content };
  });
  const newTree = await gh<{ sha: string }>('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree }) });
  const newCommit = await gh<{ sha: string }>('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parent] }),
  });
  await gh(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
  return newCommit.sha;
}
