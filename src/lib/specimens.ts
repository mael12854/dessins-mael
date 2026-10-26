import { getCollection, type CollectionEntry } from 'astro:content';

export const SERIES = { metro: 'La vie des gens du métro', hs: 'Hors-série' } as const;
export const TECH = {
  feutre: 'feutre noir sur papier, scanné',
  numerique: 'dessin numérique',
  mixte: 'feutre scanné, texte tapé',
} as const;

export type Specimen = CollectionEntry<'specimens'>['data'];

export const pad = (n: number) => String(n).padStart(3, '0');
export const plancheUrl = (n: number) => `/specimen/${n}/`;
export const ficheUrl = (n: number) => `/specimen/${n}/fiche/`;
/** Texte alternatif de la planche (description saisie, sinon titre). */
export const altFor = (s: Specimen) => s.alt || `Planche n°${s.n} : ${s.title}`;
/** Texte affiché, découpé en paragraphes. */
export const paragraphs = (t?: string) => (t ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
export const hasFiche = (s: Specimen) => s.series === 'metro' && !s.pending && !!s.fiche;

/** Tous les spécimens, du n°1 au plus récent. */
export async function allSpecimens(): Promise<Specimen[]> {
  const entries = await getCollection('specimens');
  const list = entries.map((e) => e.data).sort((a, b) => a.n - b.n);
  const seen = new Set<number>();
  for (const s of list) {
    if (seen.has(s.n)) throw new Error(`Deux spécimens portent le numéro ${s.n}.`);
    seen.add(s.n);
  }
  return list;
}
