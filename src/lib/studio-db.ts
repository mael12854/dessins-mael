// Stockage local du Studio (IndexedDB, dans le navigateur de l'auteur).
// - projects  : brouillons (document d'édition + miniature)
// - originals : fichier image d'origine, jamais modifié
// - handoff   : image finale en attente de publication dans le formulaire de l'admin

const DB_NAME = 'specimens-studio';
const VERSION = 1;

export type Slot = 'planche' | 'espece';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  doc: unknown;
  thumb?: string;
  /** Spécimen d'origine quand le projet a été ouvert depuis l'admin. */
  folder?: string | null;
  slot?: Slot;
}

export interface Handoff {
  projectId: string;
  base64: string;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  slot: Slot;
  folder: string | null;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('originals')) d.createObjectStore('originals');
        if (!d.objectStoreNames.contains('handoff')) d.createObjectStore('handoff');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
  });
}

export const listProjects = async () =>
  ((await run<ProjectRecord[]>('projects', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
export const getProject = (id: string) => run<ProjectRecord | undefined>('projects', 'readonly', (s) => s.get(id));
export const putProject = (p: ProjectRecord) => run('projects', 'readwrite', (s) => s.put(p));
export const getOriginal = (id: string) => run<Blob | undefined>('originals', 'readonly', (s) => s.get(id));
export const putOriginal = (id: string, blob: Blob) => run('originals', 'readwrite', (s) => s.put(blob, id));

export async function deleteProject(id: string) {
  await run('projects', 'readwrite', (s) => s.delete(id));
  await run('originals', 'readwrite', (s) => s.delete(id));
}

export const getHandoff = () => run<Handoff | undefined>('handoff', 'readonly', (s) => s.get('pending'));
export const setHandoff = (h: Handoff) => run('handoff', 'readwrite', (s) => s.put(h, 'pending'));
export const clearHandoff = () => run('handoff', 'readwrite', (s) => s.delete('pending'));

/** Demande au navigateur de ne pas effacer ces données en cas de manque de place. */
export async function askPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
