// Dessin des bulles (ovale, rectangle, pensée) et de leur queue.
// Coordonnées locales : centre de la bulle en (0, 0).
import type { BubbleItem } from './model';

type Pt = { x: number; y: number };
interface PathCtx {
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void; closePath(): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
}

const rr = (b: BubbleItem) => Math.min(b.w, b.h) * 0.14;

export function bodyPath(c: PathCtx, b: BubbleItem) {
  const rx = b.w / 2, ry = b.h / 2;
  if (b.shape === 'oval') { c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); return; }
  if (b.shape === 'rect') {
    const r = rr(b);
    c.moveTo(-rx + r, -ry);
    c.lineTo(rx - r, -ry); c.quadraticCurveTo(rx, -ry, rx, -ry + r);
    c.lineTo(rx, ry - r); c.quadraticCurveTo(rx, ry, rx - r, ry);
    c.lineTo(-rx + r, ry); c.quadraticCurveTo(-rx, ry, -rx, ry - r);
    c.lineTo(-rx, -ry + r); c.quadraticCurveTo(-rx, -ry, -rx + r, -ry);
    c.closePath();
    return;
  }
  // Pensée : contour en nuage (festons le long d'une ellipse).
  const n = Math.max(8, Math.round((Math.PI * (rx + ry)) / (Math.min(b.w, b.h) * 0.3)));
  const ix = rx * 0.86, iy = ry * 0.86, ox = rx * 1.06, oy = ry * 1.06;
  const p = (i: number, sx: number, sy: number) => { const a = (i / n) * Math.PI * 2; return { x: Math.cos(a) * sx, y: Math.sin(a) * sy }; };
  const s = p(0, ix, iy);
  c.moveTo(s.x, s.y);
  for (let i = 0; i < n; i++) {
    const m = p(i + 0.5, ox * 1.12, oy * 1.12), e = p(i + 1, ix, iy);
    c.quadraticCurveTo(m.x, m.y, e.x, e.y);
  }
  c.closePath();
}

/** Point du bord de la bulle dans la direction de la pointe. */
function edgePoint(b: BubbleItem): Pt {
  const { tailX: tx, tailY: ty } = b;
  const rx = b.w / 2, ry = b.h / 2;
  if (b.shape === 'rect') {
    const s = Math.min(rx / Math.max(Math.abs(tx), 1e-6), ry / Math.max(Math.abs(ty), 1e-6));
    return { x: tx * s, y: ty * s };
  }
  const t = Math.atan2(ty / ry, tx / rx);
  const k = b.shape === 'thought' ? 0.95 : 1;
  return { x: Math.cos(t) * rx * k, y: Math.sin(t) * ry * k };
}

/** La pointe est-elle hors de la bulle ? (sinon pas de queue) */
export function tailVisible(b: BubbleItem) {
  if (!b.tail) return false;
  const e = edgePoint(b);
  return Math.hypot(b.tailX, b.tailY) > Math.hypot(e.x, e.y) * 1.08;
}

function tailTriangle(b: BubbleItem): [Pt, Pt, Pt] {
  const e = edgePoint(b);
  const T = { x: b.tailX, y: b.tailY };
  const dl = Math.hypot(T.x - e.x, T.y - e.y) || 1;
  const px = -(T.y - e.y) / dl, py = (T.x - e.x) / dl; // perpendiculaire
  const hw = Math.min(b.tailWidth / 2, Math.min(b.w, b.h) * 0.3);
  const cl = Math.hypot(e.x, e.y) || 1;
  const inset = hw * 0.9; // la base rentre dans la bulle
  const bx = e.x - (e.x / cl) * inset, by = e.y - (e.y / cl) * inset;
  return [{ x: bx + px * hw, y: by + py * hw }, T, { x: bx - px * hw, y: by - py * hw }];
}

function thoughtDots(b: BubbleItem) {
  const e = edgePoint(b);
  const base = Math.min(b.w, b.h);
  return [0.3, 0.62, 0.92].map((f, i) => ({
    x: e.x + (b.tailX - e.x) * f, y: e.y + (b.tailY - e.y) * f, r: base * [0.085, 0.06, 0.04][i],
  }));
}

/** Dessin complet (remplissage + contour), queue raccordée sans couture. */
export function drawBubble(c: CanvasRenderingContext2D, b: BubbleItem) {
  const sw = Math.max(0, b.strokeWidth);
  const tail = tailVisible(b);
  const big = Math.max(b.w, b.h) * 10 + Math.hypot(b.tailX, b.tailY) * 2;
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = b.fill; c.strokeStyle = b.stroke; c.lineWidth = sw;

  c.beginPath(); bodyPath(c, b); c.fill();
  if (tail && b.shape !== 'thought') {
    const [b1, t, b2] = tailTriangle(b);
    c.beginPath(); c.moveTo(b1.x, b1.y); c.lineTo(t.x, t.y); c.lineTo(b2.x, b2.y); c.closePath(); c.fill();
    if (sw > 0) {
      // Contour du corps, sauf sous la base de la queue.
      c.save();
      c.beginPath(); c.rect(-big, -big, big * 2, big * 2);
      c.moveTo(b1.x, b1.y); c.lineTo(t.x, t.y); c.lineTo(b2.x, b2.y); c.closePath();
      c.clip('evenodd');
      c.beginPath(); bodyPath(c, b); c.stroke();
      c.restore();
      // Côtés de la queue, seulement hors de la bulle.
      c.save();
      c.beginPath(); c.rect(-big, -big, big * 2, big * 2); bodyPath(c, b); c.clip('evenodd');
      c.beginPath(); c.moveTo(b1.x, b1.y); c.lineTo(t.x, t.y); c.lineTo(b2.x, b2.y); c.stroke();
      c.restore();
    }
  } else if (sw > 0) {
    c.beginPath(); bodyPath(c, b); c.stroke();
  }
  if (tail && b.shape === 'thought') {
    for (const d of thoughtDots(b)) {
      c.beginPath(); c.ellipse(d.x, d.y, d.r * 1.25, d.r, 0, 0, Math.PI * 2); c.fill(); if (sw > 0) c.stroke();
    }
  }
  c.restore();
}

/** Zone cliquable : corps + queue. */
export function hitBubble(c: PathCtx, b: BubbleItem) {
  c.beginPath(); bodyPath(c, b); c.closePath();
  if (tailVisible(b)) {
    if (b.shape === 'thought') {
      for (const d of thoughtDots(b)) { c.moveTo(d.x + d.r * 1.25, d.y); c.ellipse(d.x, d.y, d.r * 1.25, d.r, 0, 0, Math.PI * 2); }
    } else {
      const [b1, t, b2] = tailTriangle(b);
      c.moveTo(b1.x, b1.y); c.lineTo(t.x, t.y); c.lineTo(b2.x, b2.y); c.closePath();
    }
  }
}

/** Rectangle réservé au texte à l'intérieur de la bulle. */
export function textBox(b: BubbleItem) {
  const k = b.shape === 'rect' ? 0.86 : b.shape === 'thought' ? 0.66 : 0.72;
  const w = b.w * k, h = b.h * k;
  return { x: -w / 2, y: -h / 2, width: w, height: h };
}
