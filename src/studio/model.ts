// Document du Studio : tout ce qui est posé sur le dessin, en coordonnées
// de l'image d'origine (1 unité = 1 pixel du dessin). L'image elle-même
// n'est jamais modifiée.

export type FontKey = 'hand' | 'body' | 'label' | 'gochi' | 'caveat' | 'mael';
// Ordre du menu. Shantell Sans n'est plus proposée (« retired ») mais reste lisible dans les anciens brouillons.
export const FONTS: Record<FontKey, { family: string; label: string; weights: number[]; italic: boolean; retired?: boolean; fallback?: string }> = {
  // Police tirée de l'écriture de Maël (Calligraphr, nettoyée). Il lui manque chiffres, ê, î, û, œ… : Gochi Hand prend le relais.
  mael: { family: 'Maelhandwritten', label: 'Mon écriture (Maël)', weights: [400], italic: false, fallback: 'Gochi Hand' },
  gochi: { family: 'Gochi Hand', label: 'Gochi Hand — écriture au feutre (bulles, texte)', weights: [400], italic: false },
  caveat: { family: 'Caveat Brush', label: 'Caveat Brush — étiquettes en capitales', weights: [400], italic: false },
  body: { family: 'Atkinson Hyperlegible', label: 'Atkinson Hyperlegible — texte courant du site', weights: [400, 700], italic: true },
  label: { family: 'Courier Prime', label: 'Courier Prime — étiquettes du site', weights: [400], italic: false },
  hand: { family: 'Shantell Sans Variable', label: 'Shantell Sans (ancienne police)', weights: [300, 400, 500, 600, 700, 800], italic: true, retired: true },
};

export const COLORS = [
  { value: '#1A1816', label: 'Noir feutre' },
  { value: '#C23B30', label: 'Rouge pommettes' },
  { value: '#2F5DA8', label: 'Bleu stylo' },
  { value: '#FFFFFF', label: 'Blanc' },
];

export interface TextStyle {
  font: FontKey;
  size: number;
  weight: number;
  italic: boolean;
  upper: boolean;
  align: 'left' | 'center' | 'right';
  color: string;
  lineHeight: number;
}

export interface TextItem extends TextStyle {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  rotation: number;
  text: string;
}

export type BubbleShape = 'oval' | 'rect' | 'thought';
export interface BubbleItem extends TextStyle {
  id: string;
  type: 'bubble';
  shape: BubbleShape;
  /** Centre de la bulle. */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  tail: boolean;
  /** Pointe de la queue, relative au centre. */
  tailX: number;
  tailY: number;
  tailWidth: number;
}

export interface ArrowItem {
  id: string;
  type: 'arrow';
  x1: number; y1: number; x2: number; y2: number;
  /** Courbure, de -1 à 1. */
  bend: number;
  color: string;
  width: number;
}

/** Trait de gros feutre (pour masquer l'écriture à la main). */
export interface StrokeItem {
  id: string;
  type: 'stroke';
  points: number[];
  size: number;
  /** 'auto' = couleur du papier (blanc si le fond est nettoyé). */
  color: 'auto' | string;
}

export type Item = TextItem | BubbleItem | ArrowItem | StrokeItem;
export type LayerKey = 'drawing' | 'masks' | 'bubbles' | 'texts';
export const layerOf = (it: Item): LayerKey => (it.type === 'text' ? 'texts' : it.type === 'stroke' ? 'masks' : 'bubbles');

export interface LayerState { visible: boolean; locked: boolean }
export interface Doc {
  version: 1;
  width: number;
  height: number;
  /** Fond utilisé pour l'export : dessin nettoyé ou original. */
  background: 'clean' | 'original';
  layers: Record<LayerKey, LayerState>;
  items: Item[];
}

export const newDoc = (width: number, height: number): Doc => ({
  version: 1,
  width,
  height,
  background: 'clean',
  layers: {
    drawing: { visible: true, locked: true },
    masks: { visible: true, locked: false },
    bubbles: { visible: true, locked: false },
    texts: { visible: true, locked: false },
  },
  items: [],
});

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Taille de base proportionnelle au dessin (≈ 2,5 % de la hauteur). */
export const baseSize = (d: Doc) => Math.max(16, Math.round(Math.max(d.width, d.height) * 0.025));

/** Texte et bulles : Gochi Hand en minuscules (lourde en longues capitales). */
export function newText(d: Doc, x: number, y: number): TextItem {
  const size = baseSize(d);
  return {
    id: uid(), type: 'text', x, y, width: size * 9, rotation: 0, text: 'Texte',
    font: 'gochi', size, weight: 400, italic: false, upper: false, align: 'center', color: '#1A1816', lineHeight: 1.15,
  };
}

/** Étiquette courte en capitales (« CLAIRE », « PROJECTOR 3000™ ») : Caveat Brush. */
export function newLabel(d: Doc, x: number, y: number): TextItem {
  const size = Math.round(baseSize(d) * 0.9);
  return {
    id: uid(), type: 'text', x, y, width: size * 7, rotation: 0, text: 'Étiquette',
    font: 'caveat', size, weight: 400, italic: false, upper: true, align: 'center', color: '#1A1816', lineHeight: 1.1,
  };
}

export function newBubble(d: Doc, x: number, y: number, shape: BubbleShape): BubbleItem {
  const size = baseSize(d);
  const w = size * 9, h = size * 5;
  return {
    id: uid(), type: 'bubble', shape, x, y, w, h, text: shape === 'thought' ? 'Hmm…' : 'Bonjour !',
    font: 'gochi', size, weight: 400, italic: false, upper: false, align: 'center', color: '#1A1816', lineHeight: 1.15,
    fill: '#FFFFFF', stroke: '#1A1816', strokeWidth: Math.max(2, Math.round(size / 12)),
    tail: true, tailX: -w * 0.25, tailY: h * 0.95, tailWidth: Math.round(w * 0.16),
  };
}

export function newArrow(d: Doc, x: number, y: number): ArrowItem {
  const size = baseSize(d);
  return { id: uid(), type: 'arrow', x1: x - size * 3, y1: y - size * 2, x2: x, y2: y, bend: 0.25, color: '#2F5DA8', width: Math.max(2, Math.round(size / 10)) };
}

/** Brouillons créés avant l'ajout d'un calque : on complète. */
export function migrate(d: Doc): Doc {
  d.layers.masks ??= { visible: true, locked: false };
  return d;
}

/** Valeur CSS de la police, avec la police de secours éventuelle. */
export const cssFamily = (k: FontKey) => [FONTS[k].family, FONTS[k].fallback].filter(Boolean).map((f) => `"${f}"`).join(', ');

export const displayText = (it: { text: string; upper: boolean }) => (it.upper ? it.text.toLocaleUpperCase('fr-FR') : it.text);
export const fontStyle = (it: TextStyle) => `${it.italic ? 'italic ' : ''}${it.weight}`;

export function describe(it: Item): string {
  if (it.type === 'arrow') return 'Flèche';
  if (it.type === 'stroke') return `Trait de feutre${it.color === 'auto' ? ' (couleur du papier)' : ''}`;
  const t = it.text.replace(/\s+/g, ' ').trim() || '(vide)';
  const short = t.length > 28 ? t.slice(0, 27) + '…' : t;
  if (it.type === 'text') return short;
  return `${it.shape === 'thought' ? 'Pensée' : 'Bulle'} : ${short}`;
}
