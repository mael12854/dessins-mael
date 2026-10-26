// Cœur de l'éditeur : scène Konva, rendu du document, sélection, outils,
// zoom/déplacement, annuler/rétablir et export à la taille d'origine.
import Konva from 'konva';
import { drawBubble, hitBubble, tailVisible, textBox } from './bubble';
import {
  type ArrowItem, type BubbleItem, type Doc, type FontKey, type Item, type LayerKey, type PatchItem, type StrokeItem, type TextItem,
  FONTS, baseSize, displayText, fontStyle, layerOf, migrate, newArrow, newBubble, newText, uid,
} from './model';

export type Tool = 'select' | 'text' | 'bubble-oval' | 'bubble-rect' | 'bubble-thought' | 'arrow' | 'marker' | 'ocr';
/** Outils qui tracent sur la planche : les éléments ne réagissent pas, la vue ne se déplace pas. */
const DRAW_TOOLS: Tool[] = ['marker', 'ocr'];
export type Box = { x: number; y: number; w: number; h: number };
export interface Replacement { box: Box; text: string }
export interface ReplaceStyle { font: FontKey; weight: number; color: string; cover: boolean }
export type View = 'clean' | 'original' | 'compare';

export interface EditorEvents {
  /** Le document a changé (committed = entrée d'historique créée). */
  change(doc: Doc, committed: boolean): void;
  select(item: Item | null): void;
  tool(tool: Tool): void;
  zoom(scale: number): void;
  history(canUndo: boolean, canRedo: boolean): void;
  editText(item: Item): void;
  /** Zone tracée avec l'outil « Lire l'écriture » (coordonnées du dessin). */
  ocrZone(box: Box): void;
}

const HISTORY_MAX = 150;
const ACCENT = '#2F5DA8';
const HANDLE = '#C23B30';

export class Editor {
  readonly stage: Konva.Stage;
  private bg = new Konva.Layer();
  private masks = new Konva.Layer();
  private bubbles = new Konva.Layer();
  private texts = new Konva.Layer();
  private ui = new Konva.Layer();
  private origImg = new Konva.Image({ image: undefined, listening: true, name: 'bg' });
  private cleanImg = new Konva.Image({ image: undefined, listening: true, name: 'bg' });
  private cleanGroup = new Konva.Group();
  private tr = new Konva.Transformer({
    borderStroke: ACCENT, borderStrokeWidth: 1.5, anchorStroke: ACCENT, anchorFill: '#FFFFFF',
    anchorSize: 14, anchorCornerRadius: 7, padding: 4, rotateAnchorOffset: 34,
    rotationSnaps: [0, 90, 180, 270], ignoreStroke: true, flipEnabled: false,
  });
  private tailHandle = this.handle();
  private arrowHandles = [this.handle(), this.handle(), this.handle(ACCENT)];
  private divider = new Konva.Line({ stroke: HANDLE, strokeWidth: 2, listening: false });
  private dividerHandle = this.handle(HANDLE);
  private brushCursor = new Konva.Circle({ stroke: ACCENT, strokeWidth: 1.5, dash: [4, 4], listening: false, visible: false });
  private drawing: { line: Konva.Line; points: number[] } | null = null;
  private zone = new Konva.Rect({ stroke: ACCENT, strokeWidth: 2, dash: [8, 6], fill: 'rgba(47,93,168,0.08)', listening: false, visible: false });
  private zoneStart: { x: number; y: number } | null = null;
  /** Réglages du gros feutre. */
  marker = { size: 0, color: 'auto' as string };
  /** Couleur du papier de l'original (pour le feutre « couleur du fond »). */
  private paper = '#FFFFFF';

  doc!: Doc;
  private nodes = new Map<string, Konva.Group | Konva.Text | Konva.Arrow>();
  private selected: string | null = null;
  tool: Tool = 'select';
  view: View = 'clean';
  private split = 0.5;
  private history: string[] = [];
  private hIndex = -1;
  private panned = false;
  private pinch: { dist: number; center: { x: number; y: number } } | null = null;

  constructor(private container: HTMLDivElement, private ev: EditorEvents) {
    Konva.hitOnDragEnabled = true;
    Konva.dragDistance = 4;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 300, height: container.clientHeight || 300, draggable: true });
    this.cleanGroup.add(this.cleanImg);
    this.bg.add(this.origImg, this.cleanGroup);
    this.ui.add(this.divider, this.dividerHandle, this.tr, this.tailHandle, ...this.arrowHandles, this.brushCursor, this.zone);
    this.stage.add(this.bg, this.masks, this.bubbles, this.texts, this.ui);
    this.bindStage();
    this.bindHandles();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  private handle(fill = HANDLE) {
    return new Konva.Circle({ radius: 9, fill, stroke: '#FFFFFF', strokeWidth: 2, draggable: true, visible: false, shadowColor: '#000', shadowOpacity: 0.25, shadowBlur: 4 });
  }

  // ————— Chargement —————
  load(doc: Doc, orig: CanvasImageSource, clean: CanvasImageSource, paper = '#FFFFFF') {
    this.doc = migrate(doc);
    this.paper = paper;
    if (!this.marker.size) this.marker.size = Math.round(baseSize(doc) * 1.4);
    this.origImg.setAttrs({ image: orig, width: doc.width, height: doc.height });
    this.cleanImg.setAttrs({ image: clean, width: doc.width, height: doc.height });
    this.history = [JSON.stringify(doc)];
    this.hIndex = 0;
    this.selected = null;
    this.render();
    this.setView(doc.background === 'original' ? 'original' : 'clean');
    this.fit();
    this.emitHistory();
  }

  // ————— Rendu —————
  private layerNode(k: LayerKey) { return k === 'texts' ? this.texts : k === 'bubbles' ? this.bubbles : k === 'masks' ? this.masks : this.bg; }

  render() {
    const d = this.doc;
    this.bg.visible(d.layers.drawing.visible);
    for (const k of ['masks', 'bubbles', 'texts'] as const) {
      this.layerNode(k).visible(d.layers[k].visible);
      this.layerNode(k).listening(!d.layers[k].locked && !DRAW_TOOLS.includes(this.tool));
    }
    const alive = new Set<string>();
    const order: Record<string, number> = { masks: 0, bubbles: 0, texts: 0 };
    for (const it of d.items) {
      alive.add(it.id);
      let node = this.nodes.get(it.id);
      if (!node) { node = this.create(it); this.nodes.set(it.id, node); }
      const layer = this.layerNode(layerOf(it));
      if (node.getLayer() !== layer) node.moveTo(layer);
      this.update(node, it);
      node.zIndex(order[layerOf(it)]++);
    }
    for (const [id, node] of this.nodes) if (!alive.has(id)) { node.destroy(); this.nodes.delete(id); }
    const sel = this.getSelected();
    if (this.selected && (!sel || !this.doc.layers[layerOf(sel)].visible || this.doc.layers[layerOf(sel)].locked)) this.selected = null;
    this.refreshSelectionUI();
    this.stage.batchDraw();
  }

  private create(it: Item) {
    let node: Konva.Group | Konva.Text | Konva.Arrow;
    if (it.type === 'text') {
      node = new Konva.Text({ id: it.id, draggable: true, wrap: 'word', padding: 0 });
      node.on('transform', () => {
        const t = node as Konva.Text;
        const a = this.tr.getActiveAnchor();
        const sx = t.scaleX(), sy = t.scaleY();
        if (a === 'middle-left' || a === 'middle-right') t.width(Math.max(20, t.width() * sx));
        else { t.fontSize(Math.max(6, t.fontSize() * sy)); t.width(Math.max(20, t.width() * sx)); }
        t.scale({ x: 1, y: 1 });
      });
      node.on('transformend', () => {
        const t = node as Konva.Text;
        this.patchQuiet(it.id, { x: t.x(), y: t.y(), width: t.width(), size: Math.round(t.fontSize()), rotation: t.rotation() });
        this.commit();
      });
    } else if (it.type === 'bubble') {
      const g = new Konva.Group({ id: it.id, draggable: true });
      const body = new Konva.Shape({
        name: 'body', fill: '#FFFFFF',
        sceneFunc: (ctx, shape) => drawBubble(ctx._context, shape.getAttr('bubble')),
        hitFunc: (ctx, shape) => { hitBubble(ctx, shape.getAttr('bubble')); ctx.fillShape(shape); },
      });
      const label = new Konva.Text({ name: 'label', verticalAlign: 'middle', wrap: 'word', listening: false });
      g.add(body, label);
      // Le cadre de redimensionnement suit le corps de la bulle, pas la queue.
      const orig = g.getClientRect.bind(g);
      g.getClientRect = ((cfg?: any) => {
        const b = body.getAttr('bubble') as BubbleItem | undefined;
        if (cfg?.skipTransform && b) return { x: -b.w / 2, y: -b.h / 2, width: b.w, height: b.h };
        return orig(cfg);
      }) as typeof g.getClientRect;
      g.on('transform', () => {
        const b = this.find(it.id) as BubbleItem | undefined;
        if (!b) return;
        const sx = g.scaleX(), sy = g.scaleY();
        b.w = Math.max(20, b.w * sx); b.h = Math.max(20, b.h * sy);
        b.tailX *= sx; b.tailY *= sy;
        b.x = g.x(); b.y = g.y();
        g.scale({ x: 1, y: 1 });
        this.update(g, b);
        this.placeHandles();
      });
      g.on('transformend', () => this.commit());
      node = g;
    } else if (it.type === 'patch') {
      node = new Konva.Rect({ id: it.id, draggable: true }) as unknown as Konva.Text;
      node.on('transform', () => {
        const pt = this.find(it.id) as PatchItem | undefined;
        if (!pt) return;
        pt.w = Math.max(4, pt.w * node.scaleX()); pt.h = Math.max(4, pt.h * node.scaleY());
        pt.x = node.x(); pt.y = node.y();
        node.scale({ x: 1, y: 1 });
        this.update(node, pt);
      });
      node.on('transformend', () => this.commit());
    } else if (it.type === 'stroke') {
      node = new Konva.Line({ id: it.id, draggable: true, lineCap: 'round', lineJoin: 'round', tension: 0.35 }) as unknown as Konva.Arrow;
      node.on('dragend', () => {
        const s = this.find(it.id) as StrokeItem | undefined;
        if (!s) return;
        const dx = node.x(), dy = node.y();
        node.position({ x: 0, y: 0 });
        this.patchQuiet(s.id, { points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) });
        this.commit();
      });
    } else {
      node = new Konva.Arrow({ id: it.id, draggable: true, points: [], tension: 0.5, lineCap: 'round', lineJoin: 'round', hitStrokeWidth: 24 });
      node.on('dragend', () => {
        const a = this.find(it.id) as ArrowItem | undefined;
        if (!a) return;
        const dx = node.x(), dy = node.y();
        node.position({ x: 0, y: 0 });
        this.patchQuiet(a.id, { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy });
        this.commit();
      });
    }
    node.on('mousedown touchstart', (e) => {
      if (window.TouchEvent && e.evt instanceof TouchEvent && e.evt.touches.length > 1) return;
      if (this.tool === 'marker') return; // on dessine par-dessus
      if ((it.type === 'stroke' || it.type === 'patch') && this.tool !== 'select') return; // on écrit par-dessus le feutre
      if (this.tool !== 'select') this.setTool('select');
      this.select(it.id);
    });
    node.on('dragmove', () => {
      if (it.type === 'bubble') { const b = this.find(it.id) as BubbleItem; if (b) { b.x = node.x(); b.y = node.y(); } }
      this.placeHandles();
    });
    if (it.type !== 'arrow' && it.type !== 'stroke') {
      node.on('dragend', () => { this.patchQuiet(it.id, { x: node.x(), y: node.y() }); this.commit(); });
      if (it.type !== 'patch') node.on('dblclick dbltap', () => { const cur = this.find(it.id); if (cur) this.ev.editText(cur); });
    }
    return node;
  }

  private update(node: Konva.Node, it: Item) {
    if (it.type === 'text') {
      (node as Konva.Text).setAttrs({
        x: it.x, y: it.y, width: it.width, rotation: it.rotation, text: displayText(it),
        fontFamily: `"${FONTS[it.font].family}"`, fontSize: it.size, fontStyle: fontStyle(it),
        align: it.align, fill: it.color, lineHeight: it.lineHeight,
      });
    } else if (it.type === 'bubble') {
      const g = node as Konva.Group;
      g.setAttrs({ x: it.x, y: it.y, rotation: 0 });
      const body = g.findOne('.body') as Konva.Shape;
      body.setAttr('bubble', { ...it });
      body.fill(it.fill);
      const box = textBox(it);
      (g.findOne('.label') as Konva.Text).setAttrs({
        ...box, text: displayText(it), fontFamily: `"${FONTS[it.font].family}"`, fontSize: it.size,
        fontStyle: fontStyle(it), align: it.align, fill: it.color, lineHeight: it.lineHeight,
      });
    } else if (it.type === 'patch') {
      (node as unknown as Konva.Rect).setAttrs({ x: it.x, y: it.y, width: it.w, height: it.h, fill: this.strokeColor(it.color), scaleX: 1, scaleY: 1 });
    } else if (it.type === 'stroke') {
      (node as unknown as Konva.Line).setAttrs({
        x: 0, y: 0, points: it.points, strokeWidth: it.size, stroke: this.strokeColor(it.color),
        hitStrokeWidth: Math.max(it.size, 20), draggable: this.tool !== 'marker',
      });
    } else {
      const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1) || 1;
      const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2;
      const px = -(it.y2 - it.y1) / len, py = (it.x2 - it.x1) / len;
      const off = it.bend * len * 0.25;
      (node as Konva.Arrow).setAttrs({
        x: 0, y: 0, points: [it.x1, it.y1, mx + px * off, my + py * off, it.x2, it.y2],
        stroke: it.color, fill: it.color, strokeWidth: it.width,
        pointerLength: it.width * 4.5, pointerWidth: it.width * 4,
      });
    }
  }

  /** Après chargement des polices : recalculer la mise en page des textes. */
  refreshFonts() {
    for (const node of this.nodes.values()) {
      const texts = node instanceof Konva.Text ? [node] : node instanceof Konva.Group ? (node.find('Text') as Konva.Text[]) : [];
      for (const t of texts) { const f = t.fontFamily(); t.fontFamily(''); t.fontFamily(f); }
    }
    this.stage.batchDraw();
    this.refreshSelectionUI();
  }

  // ————— Sélection —————
  find(id: string) { return this.doc.items.find((x) => x.id === id); }
  getSelected() { return this.selected ? this.find(this.selected) ?? null : null; }

  select(id: string | null) {
    if (id === this.selected) { this.refreshSelectionUI(); return; }
    this.selected = id;
    this.refreshSelectionUI();
    this.ev.select(this.getSelected());
  }

  private refreshSelectionUI() {
    const it = this.getSelected();
    const node = it ? this.nodes.get(it.id) : undefined;
    if (it && node && it.type !== 'arrow' && it.type !== 'stroke') {
      const isText = it.type === 'text';
      this.tr.setAttrs({
        rotateEnabled: isText,
        keepRatio: isText,
        enabledAnchors: isText
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
          : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'],
      });
      this.tr.nodes([node]);
    } else this.tr.nodes([]);
    this.placeHandles();
    this.ui.batchDraw();
  }

  private placeHandles() {
    const it = this.getSelected();
    const s = 1 / this.stage.scaleX();
    const all = [this.tailHandle, ...this.arrowHandles, this.dividerHandle];
    for (const h of all) h.scale({ x: s, y: s });
    this.tailHandle.visible(false);
    this.arrowHandles.forEach((h) => h.visible(false));
    if (it?.type === 'bubble' && it.tail) {
      this.tailHandle.setAttrs({ x: it.x + it.tailX, y: it.y + it.tailY, visible: true });
    } else if (it?.type === 'arrow') {
      const n = this.nodes.get(it.id) as Konva.Arrow | undefined;
      const p = n?.points() ?? [];
      const ox = n?.x() ?? 0, oy = n?.y() ?? 0;
      if (p.length === 6) {
        this.arrowHandles[0].setAttrs({ x: p[0] + ox, y: p[1] + oy, visible: true });
        this.arrowHandles[1].setAttrs({ x: p[4] + ox, y: p[5] + oy, visible: true });
        this.arrowHandles[2].setAttrs({ x: p[2] + ox, y: p[3] + oy, visible: true });
      }
    }
    if (this.view === 'compare') {
      const x = this.split * this.doc.width;
      this.divider.setAttrs({ points: [x, 0, x, this.doc.height], strokeWidth: 2 * s, visible: true });
      this.dividerHandle.setAttrs({ x, y: this.visibleCenterY(), visible: true });
    } else { this.divider.visible(false); this.dividerHandle.visible(false); }
    this.ui.batchDraw();
  }

  private visibleCenterY() {
    const s = this.stage.scaleX();
    const y = (this.stage.height() / 2 - this.stage.y()) / s;
    return Math.min(Math.max(y, 0), this.doc?.height ?? 0);
  }

  private bindHandles() {
    this.tailHandle.on('dragmove', () => {
      const b = this.getSelected();
      if (b?.type !== 'bubble') return;
      b.tailX = this.tailHandle.x() - b.x; b.tailY = this.tailHandle.y() - b.y;
      const n = this.nodes.get(b.id); if (n) this.update(n, b);
      this.bubbles.batchDraw();
    });
    this.tailHandle.on('dragend', () => this.commit());
    this.arrowHandles.forEach((h, i) => {
      h.on('dragmove', () => {
        const a = this.getSelected();
        if (a?.type !== 'arrow') return;
        if (i === 0) { a.x1 = h.x(); a.y1 = h.y(); }
        else if (i === 1) { a.x2 = h.x(); a.y2 = h.y(); }
        else {
          const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
          const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
          const px = -(a.y2 - a.y1) / len, py = (a.x2 - a.x1) / len;
          a.bend = Math.max(-1.5, Math.min(1.5, ((h.x() - mx) * px + (h.y() - my) * py) / (len * 0.25)));
        }
        const n = this.nodes.get(a.id); if (n) this.update(n, a);
        if (i !== 2) this.placeHandles();
        this.bubbles.batchDraw();
      });
      h.on('dragend', () => { this.placeHandles(); this.commit(); });
    });
    this.dividerHandle.on('dragmove', () => {
      this.split = Math.min(1, Math.max(0, this.dividerHandle.x() / this.doc.width));
      this.dividerHandle.y(this.visibleCenterY());
      this.applyView();
    });
  }

  // ————— Outils et interactions —————
  setTool(t: Tool) {
    const wasDraw = DRAW_TOOLS.includes(this.tool);
    this.tool = t;
    this.container.style.cursor = t === 'select' ? 'default' : t === 'marker' ? 'none' : 'crosshair';
    this.stage.draggable(!DRAW_TOOLS.includes(t));
    if (t !== 'marker') { this.brushCursor.visible(false); this.ui.batchDraw(); }
    if (t !== 'ocr') this.clearZone();
    if (t !== 'select') this.select(null);
    if (wasDraw !== DRAW_TOOLS.includes(t)) this.render(); // éléments actifs ou non
    this.ev.tool(t);
  }

  setMarker(p: Partial<{ size: number; color: string }>) {
    Object.assign(this.marker, p);
    this.brushCursor.radius(this.marker.size / 2);
    this.ui.batchDraw();
  }

  /** Couleur réelle d'un trait : « auto » = papier du fond affiché. */
  private strokeColor(c: string) {
    if (c !== 'auto') return c;
    const bg = this.view === 'compare' ? this.doc.background : this.view;
    return bg === 'original' ? this.paper : '#FFFFFF';
  }

  private refreshStrokes() {
    for (const it of this.doc.items) {
      const n = this.nodes.get(it.id) as unknown as Konva.Shape | undefined;
      if (it.type === 'stroke') n?.stroke(this.strokeColor(it.color));
      else if (it.type === 'patch') n?.fill(this.strokeColor(it.color));
    }
    this.masks.batchDraw();
  }

  // ————— Gros feutre —————
  private startStroke(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (window.TouchEvent && e.evt instanceof TouchEvent && e.evt.touches.length > 1) return;
    const p = this.masks.getRelativePointerPosition();
    if (!p) return;
    const line = new Konva.Line({
      points: [p.x, p.y, p.x + 0.01, p.y], stroke: this.strokeColor(this.marker.color), strokeWidth: this.marker.size,
      lineCap: 'round', lineJoin: 'round', tension: 0.35, listening: false,
    });
    this.masks.add(line);
    this.drawing = { line, points: [p.x, p.y] };
    this.masks.batchDraw();
  }

  private moveStroke() {
    const p = this.masks.getRelativePointerPosition();
    if (!p) return;
    if (this.tool === 'marker' && !this.pinch) {
      this.brushCursor.setAttrs({ x: p.x, y: p.y, radius: this.marker.size / 2, strokeWidth: 1.5 / this.stage.scaleX(), visible: true });
      this.ui.batchDraw();
    }
    const d = this.drawing;
    if (!d) return;
    const n = d.points.length;
    if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) < Math.max(1, this.marker.size * 0.08)) return;
    d.points.push(p.x, p.y);
    d.line.points(d.points);
    this.masks.batchDraw();
  }

  private endStroke() {
    const d = this.drawing;
    if (!d) return;
    this.drawing = null;
    d.line.destroy();
    const pts = d.points.length >= 4 ? d.points : [d.points[0], d.points[1], d.points[0] + 0.01, d.points[1]];
    const it: StrokeItem = { id: uid(), type: 'stroke', points: pts.map((v) => Math.round(v * 10) / 10), size: this.marker.size, color: this.marker.color };
    this.add(it);
  }

  private cancelStroke() {
    if (!this.drawing) return;
    this.drawing.line.destroy();
    this.drawing = null;
    this.masks.batchDraw();
  }

  private bindStage() {
    const st = this.stage;
    st.on('dragstart', (e) => { if (e.target === st) this.panned = true; });
    st.on('dragmove', (e) => { if (e.target === st) this.placeHandles(); });
    st.on('click tap', (e) => {
      if (this.panned) { this.panned = false; return; }
      if (DRAW_TOOLS.includes(this.tool)) return;
      const t = e.target;
      const onBackground = t === st || t.hasName('bg') || (t.getLayer() === this.masks && this.tool !== 'select');
      if (!onBackground) return;
      if (this.tool === 'select') { this.select(null); return; }
      const p = this.texts.getRelativePointerPosition();
      if (!p) return;
      this.createAt(this.tool, p.x, p.y);
    });
    st.on('mousedown touchstart', (e) => {
      this.panned = false;
      if (this.tool === 'marker') this.startStroke(e);
      else if (this.tool === 'ocr') this.startZone(e);
    });
    st.on('mousemove touchmove', () => { this.moveStroke(); this.moveZone(); });
    st.on('mouseup touchend', () => { this.endStroke(); this.endZone(); });
    window.addEventListener('mouseup', () => this.endZone());
    st.on('mouseleave', () => { this.brushCursor.visible(false); this.ui.batchDraw(); });
    window.addEventListener('mouseup', () => this.endStroke());

    st.on('wheel', (e) => {
      e.evt.preventDefault();
      const ev = e.evt as WheelEvent;
      if (ev.ctrlKey || ev.metaKey) {
        const p = st.getPointerPosition() ?? { x: st.width() / 2, y: st.height() / 2 };
        this.zoomAt(st.scaleX() * Math.pow(1.002, -Math.max(-200, Math.min(200, ev.deltaY))), p);
      } else {
        st.position({ x: st.x() - ev.deltaX, y: st.y() - ev.deltaY });
        this.placeHandles();
        st.batchDraw();
      }
    });

    // Pincer pour zoomer (deux doigts).
    st.on('touchmove', (e) => {
      const touches = (e.evt as TouchEvent).touches;
      if (touches.length !== 2) return;
      e.evt.preventDefault();
      this.cancelStroke();
      if (this.zoneStart) this.clearZone();
      this.brushCursor.visible(false);
      if (st.isDragging()) st.stopDrag();
      for (const n of this.nodes.values()) if (n.isDragging()) n.stopDrag();
      const r = this.container.getBoundingClientRect();
      const p1 = { x: touches[0].clientX - r.left, y: touches[0].clientY - r.top };
      const p2 = { x: touches[1].clientX - r.left, y: touches[1].clientY - r.top };
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (!this.pinch) { this.pinch = { dist, center }; return; }
      const s0 = st.scaleX();
      const pointTo = { x: (this.pinch.center.x - st.x()) / s0, y: (this.pinch.center.y - st.y()) / s0 };
      const s1 = this.clampScale(s0 * (dist / this.pinch.dist));
      st.scale({ x: s1, y: s1 });
      st.position({ x: center.x - pointTo.x * s1, y: center.y - pointTo.y * s1 });
      this.pinch = { dist, center };
      this.panned = true;
      this.afterZoom();
    });
    st.on('touchend touchcancel', () => { this.pinch = null; });
  }

  createAt(tool: Tool, x: number, y: number) {
    let it: Item;
    if (tool === 'text') it = newText(this.doc, x, y);
    else if (tool === 'arrow') it = newArrow(this.doc, x, y);
    else it = newBubble(this.doc, x, y, tool === 'bubble-rect' ? 'rect' : tool === 'bubble-thought' ? 'thought' : 'oval');
    if (it.type === 'text') { it.x -= it.width / 2; it.y -= it.size / 2; }
    this.add(it);
    this.setTool('select');
    this.select(it.id);
    if (it.type !== 'arrow') this.ev.editText(it);
  }

  // ————— Lire l'écriture : zone tracée —————
  private startZone(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (window.TouchEvent && e.evt instanceof TouchEvent && e.evt.touches.length > 1) return;
    const p = this.texts.getRelativePointerPosition();
    if (!p) return;
    this.zoneStart = p;
    this.zone.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true, strokeWidth: 2 / this.stage.scaleX(), dash: [8 / this.stage.scaleX(), 6 / this.stage.scaleX()] });
    this.ui.batchDraw();
  }

  private moveZone() {
    if (!this.zoneStart || this.pinch) return;
    const p = this.texts.getRelativePointerPosition();
    if (!p) return;
    const a = this.zoneStart;
    this.zone.setAttrs({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y) });
    this.ui.batchDraw();
  }

  private endZone() {
    if (!this.zoneStart) return;
    this.zoneStart = null;
    const W = this.doc.width, H = this.doc.height;
    const x = Math.max(0, this.zone.x()), y = Math.max(0, this.zone.y());
    const box = { x, y, w: Math.min(W, this.zone.x() + this.zone.width()) - x, h: Math.min(H, this.zone.y() + this.zone.height()) - y };
    const min = 12 / this.stage.scaleX(); // au moins ~12 px à l'écran
    if (box.w < min || box.h < min) { this.clearZone(); return; }
    this.zone.setAttrs(box.w ? { x: box.x, y: box.y, width: box.w, height: box.h } : {});
    this.ui.batchDraw();
    this.ev.ocrZone({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
  }

  /** Efface le cadre de sélection. */
  clearZone() {
    this.zoneStart = null;
    if (this.zone.visible()) { this.zone.visible(false); this.ui.batchDraw(); }
  }

  /** Affiche un cadre (aperçu d'une zone détectée sur la page). */
  showZone(box: Box | null) {
    if (!box) { this.clearZone(); return; }
    const k = this.stage.scaleX();
    this.zone.setAttrs({ x: box.x, y: box.y, width: box.w, height: box.h, visible: true, strokeWidth: 2 / k, dash: [8 / k, 6 / k] });
    this.ui.batchDraw();
  }

  /** Texte de la police choisie, de la plus grande taille qui tient dans le cadre. */
  private fitText(text: string, style: ReplaceStyle, box: Box): TextItem {
    const probe = new Konva.Text({ text, width: box.w, wrap: 'word', lineHeight: 1.1, fontFamily: `"${FONTS[style.font].family}"`, fontStyle: String(style.weight) });
    const lines = Math.max(1, text.split('\n').length);
    let size = Math.max(6, Math.floor((box.h * 0.92) / (lines * 1.1)));
    for (let i = 0; i < 60 && size > 6; i++) {
      probe.fontSize(size);
      // assez petit pour que le texte tienne en hauteur et qu'aucun mot ne soit coupé
      const longest = Math.max(...text.split(/\s+/).map((w) => probe.measureSize(w).width));
      if (probe.height() <= box.h && longest <= box.w) break;
      size = Math.floor(size * 0.94);
    }
    probe.fontSize(size);
    const hgt = probe.height();
    probe.destroy();
    return {
      id: uid(), type: 'text', x: box.x, y: box.y + Math.max(0, (box.h - hgt) / 2), width: box.w, rotation: 0, text,
      font: style.font, size, weight: style.weight, italic: false, upper: false, align: 'center', color: style.color, lineHeight: 1.1,
    };
  }

  /** Remplace des écritures : cache couleur papier (option) + texte tapé. Une seule étape d'annulation. */
  replaceWithText(entries: Replacement[], style: ReplaceStyle) {
    if (!entries.length) return;
    for (const L of ['masks', 'texts'] as const) { this.doc.layers[L].visible = true; this.doc.layers[L].locked = false; }
    let last: TextItem | null = null;
    for (const { box, text } of entries) {
      if (style.cover) {
        const pad = Math.max(2, Math.round(Math.min(box.w, box.h) * 0.06));
        const patch: PatchItem = { id: uid(), type: 'patch', x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2, color: 'auto' };
        this.doc.items.push(patch);
      }
      last = this.fitText(text, style, box);
      this.doc.items.push(last);
    }
    this.clearZone();
    this.setTool('select');
    this.render();
    this.commit();
    if (last) this.select(last.id);
  }

  // ————— Modifications —————
  private patchQuiet(id: string, p: Partial<Item>) {
    const it = this.find(id);
    if (it) Object.assign(it, p);
  }

  patch(id: string, p: Partial<Item>, commit = true) {
    this.patchQuiet(id, p);
    this.render();
    if (commit) this.commit(); else this.ev.change(this.doc, false);
  }

  add(it: Item) {
    const layer = layerOf(it);
    if (this.doc.layers[layer].locked) this.doc.layers[layer].locked = false;
    if (!this.doc.layers[layer].visible) this.doc.layers[layer].visible = true;
    this.doc.items.push(it);
    this.render();
    this.commit();
  }

  remove(id = this.selected) {
    if (!id) return;
    this.doc.items = this.doc.items.filter((x) => x.id !== id);
    if (this.selected === id) this.select(null);
    this.render();
    this.commit();
  }

  duplicate(id = this.selected) {
    const it = id ? this.find(id) : null;
    if (!it) return;
    const off = Math.round(Math.max(this.doc.width, this.doc.height) * 0.02);
    const copy = { ...structuredClone(it), id: uid() } as Item;
    if (copy.type === 'arrow') { copy.x1 += off; copy.x2 += off; copy.y1 += off; copy.y2 += off; }
    else if (copy.type === 'stroke') copy.points = copy.points.map((v) => v + off);
    else { copy.x += off; copy.y += off; }
    this.doc.items.push(copy);
    this.render();
    this.select(copy.id);
    this.commit();
  }

  /** Change l'ordre d'empilement dans le calque de l'élément. */
  reorder(id: string, dir: 'front' | 'back' | 'up' | 'down') {
    const it = this.find(id);
    if (!it) return;
    const L = layerOf(it);
    const same = this.doc.items.filter((x) => layerOf(x) === L);
    const others = this.doc.items.filter((x) => layerOf(x) !== L);
    const i = same.indexOf(it);
    same.splice(i, 1);
    const j = dir === 'front' ? same.length : dir === 'back' ? 0 : dir === 'up' ? Math.min(same.length, i + 1) : Math.max(0, i - 1);
    same.splice(j, 0, it);
    this.doc.items = [...others, ...same];
    this.render();
    this.commit();
  }

  nudge(dx: number, dy: number) {
    const it = this.getSelected();
    if (!it) return;
    if (it.type === 'arrow') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
    else if (it.type === 'stroke') it.points = it.points.map((v, i) => v + (i % 2 ? dy : dx));
    else { it.x += dx; it.y += dy; }
    this.render();
    this.commitSoon();
  }

  setLayer(k: LayerKey, p: Partial<{ visible: boolean; locked: boolean }>) {
    Object.assign(this.doc.layers[k], p);
    this.render();
    this.commit();
  }

  setBackground(bg: 'clean' | 'original') {
    this.doc.background = bg;
    this.commit();
    if (this.view !== 'compare') this.setView(bg);
    else this.refreshStrokes();
  }

  /** Agrandit la bulle pour que le texte tienne dedans. */
  fitBubble(id: string) {
    const b = this.find(id);
    if (b?.type !== 'bubble') return;
    const box = textBox(b);
    const t = new Konva.Text({
      text: displayText(b), width: box.width, fontFamily: `"${FONTS[b.font].family}"`, fontSize: b.size,
      fontStyle: fontStyle(b), lineHeight: b.lineHeight, wrap: 'word',
    });
    const k = box.height / b.h;
    const need = t.height() / k + b.size * 0.6;
    t.destroy();
    const ratio = need / b.h;
    b.tailY *= ratio;
    b.h = Math.max(b.size * 2, need);
    this.render();
    this.commit();
  }

  // ————— Historique —————
  private commitTimer = 0;
  commitSoon() { clearTimeout(this.commitTimer); this.commitTimer = window.setTimeout(() => this.commit(), 500); }

  commit() {
    clearTimeout(this.commitTimer);
    this.commitTimer = 0;
    const snap = JSON.stringify(this.doc);
    if (snap === this.history[this.hIndex]) { this.ev.change(this.doc, false); return; }
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push(snap);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.ev.change(this.doc, true);
    this.emitHistory();
  }

  private restore(i: number) {
    this.hIndex = i;
    this.doc = migrate(JSON.parse(this.history[i]));
    this.render();
    this.ev.select(this.getSelected());
    this.ev.change(this.doc, true);
    this.emitHistory();
    if (this.view !== 'compare') this.setView(this.doc.background);
  }
  undo() { this.flushPending(); if (this.hIndex > 0) this.restore(this.hIndex - 1); }
  redo() { if (this.hIndex < this.history.length - 1) this.restore(this.hIndex + 1); }
  private flushPending() { if (this.commitTimer) this.commit(); }
  private emitHistory() { this.ev.history(this.hIndex > 0, this.hIndex < this.history.length - 1); }

  // ————— Vue : fond, comparaison, zoom —————
  setView(v: View) {
    this.view = v;
    this.applyView();
    this.placeHandles();
  }

  private applyView() {
    const W = this.doc.width;
    this.origImg.visible(this.view !== 'clean');
    this.cleanGroup.visible(this.view !== 'original');
    if (this.view === 'compare') {
      const x = this.split * W;
      this.cleanGroup.clipFunc((ctx) => { ctx.rect(x, 0, W - x, this.doc.height); });
    } else this.cleanGroup.clipFunc(undefined as any);
    this.divider.points([this.split * W, 0, this.split * W, this.doc.height]);
    this.refreshStrokes();
    this.bg.batchDraw();
    this.ui.batchDraw();
  }

  private clampScale(s: number) { return Math.min(8, Math.max(0.02, s)); }
  private afterZoom() { this.placeHandles(); this.stage.batchDraw(); this.ev.zoom(this.stage.scaleX()); }

  zoomAt(scale: number, p: { x: number; y: number }) {
    const st = this.stage, s0 = st.scaleX(), s1 = this.clampScale(scale);
    const pointTo = { x: (p.x - st.x()) / s0, y: (p.y - st.y()) / s0 };
    st.scale({ x: s1, y: s1 });
    st.position({ x: p.x - pointTo.x * s1, y: p.y - pointTo.y * s1 });
    this.afterZoom();
  }
  zoomBy(f: number) { this.zoomAt(this.stage.scaleX() * f, { x: this.stage.width() / 2, y: this.stage.height() / 2 }); }

  fit() {
    const st = this.stage, pad = Math.min(32, st.width() * 0.04);
    const s = this.clampScale(Math.min((st.width() - pad * 2) / this.doc.width, (st.height() - pad * 2) / this.doc.height));
    st.scale({ x: s, y: s });
    st.position({ x: (st.width() - this.doc.width * s) / 2, y: (st.height() - this.doc.height * s) / 2 });
    this.afterZoom();
  }
  actualSize() { this.zoomAt(1, { x: this.stage.width() / 2, y: this.stage.height() / 2 }); }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const first = this.stage.width() < 10;
    const dw = w - this.stage.width(), dh = h - this.stage.height();
    this.stage.size({ width: w, height: h });
    if (this.doc && first) { this.fit(); return; }
    // Garder le même point au centre de l'écran (ouverture du tiroir sur téléphone).
    this.stage.position({ x: this.stage.x() + dw / 2, y: this.stage.y() + dh / 2 });
    this.placeHandles();
    this.stage.batchDraw();
  }

  // ————— Export —————
  /** Image finale à la taille exacte du dessin d'origine. */
  renderFinal(maxSide?: number): HTMLCanvasElement {
    const st = this.stage;
    const saved = { scale: st.scaleX(), pos: st.position(), view: this.view };
    const sel = this.selected;
    this.selected = null;
    this.tr.nodes([]);
    this.ui.visible(false);
    this.view = this.doc.background;
    this.applyView();
    const ratio = maxSide ? Math.min(1, maxSide / Math.max(this.doc.width, this.doc.height)) : 1;
    st.scale({ x: 1, y: 1 });
    st.position({ x: 0, y: 0 });
    let canvas: HTMLCanvasElement;
    try {
      canvas = st.toCanvas({ x: 0, y: 0, width: this.doc.width, height: this.doc.height, pixelRatio: ratio, imageSmoothingEnabled: true });
    } finally {
      st.scale({ x: saved.scale, y: saved.scale });
      st.position(saved.pos);
      this.ui.visible(true);
      this.view = saved.view;
      this.applyView();
      this.selected = sel;
      this.refreshSelectionUI();
      st.batchDraw();
    }
    return canvas;
  }
}
