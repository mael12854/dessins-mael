// Panneau latéral : propriétés de l'élément sélectionné, ou calques.
import type { Editor } from './editor';
import { COLORS, FONTS, type BubbleItem, type FontKey, type Item, type LayerKey, type PatchItem, type StrokeItem, type TextItem, baseSize, describe, layerOf } from './model';

type El = HTMLElement;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') (e as any)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};

const field = (label: string, ...control: (Node | null)[]) => h('label', { class: 'f' }, h('span', { class: 'f-label' }, label), ...control);

function segmented<T extends string>(value: T, options: [T, string, string?][], onPick: (v: T) => void) {
  return h('div', { class: 'seg', role: 'group' },
    ...options.map(([v, label, title]) =>
      h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': String(v === value), title: title ?? label, onclick: () => onPick(v) }, label)));
}

function colorPicker(value: string, onPick: (v: string) => void) {
  const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000', title: 'Autre couleur', 'aria-label': 'Autre couleur' }) as HTMLInputElement;
  custom.addEventListener('change', () => onPick(custom.value));
  return h('div', { class: 'swatches' },
    ...COLORS.map((c) => h('button', {
      type: 'button', class: 'sw' + (c.value.toLowerCase() === value.toLowerCase() ? ' on' : ''),
      style: `--c:${c.value}`, title: c.label, 'aria-label': c.label, onclick: () => onPick(c.value),
    })),
    custom);
}

function number(value: number, min: number, max: number, step: number, onSet: (v: number) => void) {
  const range = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  const num = h('input', { type: 'number', min, max, step, value: Math.round(value * 100) / 100, class: 'num' }) as HTMLInputElement;
  range.addEventListener('input', () => { num.value = range.value; onSet(Number(range.value)); });
  // Appliqué pendant la frappe (le dessin suit le champ), borné à la validation.
  num.addEventListener('input', () => { const v = Number(num.value); if (num.value !== '' && v >= min && v <= max) { range.value = String(v); onSet(v); } });
  num.addEventListener('change', () => { const v = Math.min(max, Math.max(min, Number(num.value) || min)); num.value = String(v); range.value = String(v); onSet(v); });
  return h('div', { class: 'numrow' }, range, num);
}

export class Panel {
  tab: 'props' | 'layers' = 'layers';
  textArea: HTMLTextAreaElement | null = null;

  /** Bouton « Lire toute la planche » de l'outil Lire l'écriture. */
  onReadPage: () => void = () => {};
  /** Lecture disponible (clé configurée côté serveur) ? null = inconnu. */
  ocrReady: boolean | null = null;

  constructor(private root: El, private ed: Editor, private onTab: (t: 'props' | 'layers') => void) {}

  render() {
    const it = this.ed.getSelected();
    if (!it && this.tab === 'props') this.tab = 'layers';
    this.root.replaceChildren(
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', class: this.tab === 'props' ? 'on' : '', 'aria-selected': String(this.tab === 'props'), disabled: !it, onclick: () => this.setTab('props') }, 'Propriétés'),
        h('button', { type: 'button', role: 'tab', class: this.tab === 'layers' ? 'on' : '', 'aria-selected': String(this.tab === 'layers'), onclick: () => this.setTab('layers') }, 'Calques')),
      h('div', { class: 'panel-body' },
        this.ed.tool === 'marker' && !it ? this.markerSettings() : null,
        this.ed.tool === 'ocr' && !it ? this.ocrSettings() : null,
        this.tab === 'props' && it ? this.props(it) : this.layers()),
    );
  }

  /** Couleur du trait : papier (auto) ou une couleur choisie. */
  private strokeColorPicker(value: string, onPick: (v: string) => void) {
    return h('div', { class: 'col' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: value === 'auto', onchange: (e: Event) => onPick((e.target as HTMLInputElement).checked ? 'auto' : '#FFFFFF') }),
        ' Couleur du papier (automatique)'),
      value === 'auto' ? null : colorPicker(value, onPick));
  }

  private ocrSettings(): El {
    return h('div', { class: 'props marker-box' },
      h('h3', { class: 'p-title' }, 'Lire l’écriture'),
      h('p', { class: 'hint' }, 'Encadre un texte écrit à la main (glisse sur la planche) : il est lu, tu le vérifies, puis il est remplacé par du texte tapé dans une police du site. L’écriture d’origine est cachée par un rectangle couleur papier.'),
      h('button', { type: 'button', class: 'btn ghost', 'data-read-page': true, disabled: this.ocrReady === false, onclick: () => this.onReadPage() }, 'Lire toute la planche'),
      this.ocrReady === false ? h('p', { class: 'msg' }, 'Lecture non activée : la clé ANTHROPIC_API_KEY manque dans Vercel.') : null,
    );
  }

  private markerSettings(): El {
    const ed = this.ed;
    const max = Math.max(60, baseSize(ed.doc) * 8);
    return h('div', { class: 'props marker-box' },
      h('h3', { class: 'p-title' }, 'Gros feutre'),
      h('p', { class: 'hint' }, 'Peins par-dessus ton écriture pour la cacher, puis ajoute un texte avec l’outil « Texte ». Deux doigts pour zoomer.'),
      field('Épaisseur', number(ed.marker.size, 4, max, 1, (v) => ed.setMarker({ size: v }))),
      field('Couleur', this.strokeColorPicker(ed.marker.color, (v) => { ed.setMarker({ color: v }); this.render(); })),
    );
  }

  setTab(t: 'props' | 'layers') { this.tab = t; this.render(); this.onTab(t); }

  focusText() {
    if (this.tab !== 'props') { this.tab = 'props'; this.render(); }
    const ta = this.textArea;
    if (ta) { this.root.scrollTop = 0; ta.focus({ preventScroll: true }); ta.select(); }
  }

  // ————— Propriétés —————
  private props(it: Item): El {
    const ed = this.ed;
    const set = (p: Partial<Item>) => ed.patch(it.id, p);
    const wrap = h('div', { class: 'props' });
    const title = it.type === 'text' ? 'Texte' : it.type === 'arrow' ? 'Flèche' : it.type === 'stroke' ? 'Trait de feutre' : it.type === 'patch' ? 'Cache' : it.shape === 'thought' ? 'Bulle de pensée' : 'Bulle';
    wrap.append(h('h3', { class: 'p-title' }, title));

    if (it.type === 'stroke') {
      wrap.append(
        field('Épaisseur', number(it.size, 4, Math.max(60, baseSize(ed.doc) * 8), 1, (v) => { ed.patch(it.id, { size: v } as Partial<StrokeItem>, false); ed.commitSoon(); })),
        field('Couleur', this.strokeColorPicker(it.color, (v) => { set({ color: v } as Partial<StrokeItem>); this.render(); })),
      );
    }

    if (it.type === 'patch') {
      wrap.append(
        h('p', { class: 'hint' }, 'Rectangle qui cache l’écriture d’origine. Ajuste-le avec les poignées.'),
        field('Couleur', this.strokeColorPicker(it.color, (v) => { set({ color: v } as Partial<PatchItem>); this.render(); })),
      );
    }

    if (it.type !== 'arrow' && it.type !== 'stroke' && it.type !== 'patch') {
      const ta = h('textarea', { rows: 3, spellcheck: true, lang: 'fr', placeholder: 'Écris ici…' }) as HTMLTextAreaElement;
      ta.value = it.text;
      ta.addEventListener('input', () => { ed.patch(it.id, { text: ta.value }, false); ed.commitSoon(); });
      ta.addEventListener('blur', () => ed.commit());
      this.textArea = ta;
      wrap.append(field('Texte', ta));
      wrap.append(...this.textStyle(it, set));
    }

    if (it.type === 'bubble') {
      wrap.append(
        field('Forme', segmented(it.shape, [['oval', 'Ovale'], ['rect', 'Carrée'], ['thought', 'Pensée']], (v) => { set({ shape: v } as Partial<BubbleItem>); this.render(); })),
        field('Fond', colorPicker(it.fill, (v) => { set({ fill: v } as Partial<BubbleItem>); this.render(); })),
        field('Contour', colorPicker(it.stroke, (v) => { set({ stroke: v } as Partial<BubbleItem>); this.render(); })),
        field('Épaisseur du contour', number(it.strokeWidth, 0, Math.max(20, baseSize(ed.doc) / 2), 1, (v) => { ed.patch(it.id, { strokeWidth: v } as Partial<BubbleItem>, false); ed.commitSoon(); })),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: it.tail, onchange: (e: Event) => { set({ tail: (e.target as HTMLInputElement).checked } as Partial<BubbleItem>); this.render(); } }),
          ' Queue (déplace le point rouge pour l’orienter)'),
        ...(it.tail ? [field('Largeur de la queue', number(it.tailWidth, 4, Math.round(Math.min(it.w, it.h) * 0.6), 1, (v) => { ed.patch(it.id, { tailWidth: v } as Partial<BubbleItem>, false); ed.commitSoon(); }))] : []),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => ed.fitBubble(it.id) }, 'Ajuster la bulle au texte'),
      );
    }

    if (it.type === 'arrow') {
      wrap.append(
        h('p', { class: 'hint' }, 'Déplace les points rouges pour placer le départ et la pointe, le point bleu pour courber.'),
        field('Couleur', colorPicker(it.color, (v) => { set({ color: v }); this.render(); })),
        field('Épaisseur', number(it.width, 1, Math.max(30, baseSize(ed.doc) / 2), 1, (v) => { ed.patch(it.id, { width: v }, false); ed.commitSoon(); })),
      );
    }

    wrap.append(
      h('div', { class: 'p-actions' },
        h('div', { class: 'seg' },
          h('button', { type: 'button', title: 'Mettre tout devant', onclick: () => ed.reorder(it.id, 'front') }, 'Devant'),
          h('button', { type: 'button', title: 'Avancer d’un cran', onclick: () => ed.reorder(it.id, 'up') }, '↑'),
          h('button', { type: 'button', title: 'Reculer d’un cran', onclick: () => ed.reorder(it.id, 'down') }, '↓'),
          h('button', { type: 'button', title: 'Mettre tout derrière', onclick: () => ed.reorder(it.id, 'back') }, 'Derrière')),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => ed.duplicate(it.id) }, 'Dupliquer'),
          h('button', { type: 'button', class: 'btn danger', onclick: () => ed.remove(it.id) }, 'Supprimer'))),
    );
    return wrap;
  }

  private textStyle(it: TextItem | BubbleItem, set: (p: Partial<Item>) => void): El[] {
    const ed = this.ed;
    const font = FONTS[it.font];
    const fontSel = h('select', { onchange: (e: Event) => {
      const f = (e.target as HTMLSelectElement).value as FontKey;
      const ws = FONTS[f].weights;
      const weight = ws.includes(it.weight) ? it.weight : ws.reduce((a, b) => (Math.abs(b - it.weight) < Math.abs(a - it.weight) ? b : a));
      set({ font: f, weight, italic: FONTS[f].italic ? it.italic : false } as Partial<Item>);
      this.render();
    } }, ...(Object.keys(FONTS) as FontKey[]).map((k) => h('option', { value: k, selected: k === it.font }, FONTS[k].label)));
    const weightNames: Record<number, string> = { 400: 'Normal', 500: 'Moyen', 600: 'Demi-gras', 700: 'Gras', 800: 'Très gras' };
    const weightSel = h('select', { disabled: font.weights.length < 2, onchange: (e: Event) => set({ weight: Number((e.target as HTMLSelectElement).value) } as Partial<Item>) },
      ...font.weights.map((w) => h('option', { value: w, selected: w === it.weight }, weightNames[w] ?? String(w))));
    const max = Math.max(200, baseSize(ed.doc) * 6);
    return [
      h('div', { class: 'grid2' }, field('Police', fontSel), field('Graisse', weightSel)),
      field('Taille', number(it.size, 6, max, 1, (v) => { ed.patch(it.id, { size: v } as Partial<Item>, false); ed.commitSoon(); })),
      field('Alignement', segmented(it.align, [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], (v) => { set({ align: v } as Partial<Item>); this.render(); })),
      h('div', { class: 'row wrap' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.upper, onchange: (e: Event) => set({ upper: (e.target as HTMLInputElement).checked } as Partial<Item>) }), ' Majuscules'),
        font.italic ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.italic, onchange: (e: Event) => set({ italic: (e.target as HTMLInputElement).checked } as Partial<Item>) }), ' Italique') : null),
      field('Couleur du texte', colorPicker(it.color, (v) => { set({ color: v } as Partial<Item>); this.render(); })),
      field('Interligne', number(it.lineHeight, 0.8, 2, 0.05, (v) => { ed.patch(it.id, { lineHeight: v } as Partial<Item>, false); ed.commitSoon(); })),
    ];
  }

  // ————— Calques —————
  private layers(): El {
    const ed = this.ed, d = ed.doc;
    const sel = ed.getSelected();
    const section = (key: LayerKey, label: string) => {
      const L = d.layers[key];
      const items = d.items.filter((x) => layerOf(x) === key).slice().reverse();
      return h('section', { class: 'layer' + (L.visible ? '' : ' hidden') },
        h('header', { class: 'layer-head' },
          h('strong', {}, label),
          h('span', { class: 'count' }, String(items.length)),
          h('button', { type: 'button', class: 'mini', title: L.visible ? 'Masquer ce calque' : 'Afficher ce calque', 'aria-pressed': String(!L.visible), onclick: () => { ed.setLayer(key, { visible: !L.visible }); this.render(); } }, L.visible ? 'Visible' : 'Masqué'),
          h('button', { type: 'button', class: 'mini', title: L.locked ? 'Déverrouiller' : 'Verrouiller (empêche de déplacer par erreur)', 'aria-pressed': String(L.locked), onclick: () => { ed.setLayer(key, { locked: !L.locked }); this.render(); } }, L.locked ? 'Verrouillé' : 'Modifiable')),
        items.length
          ? h('ol', { class: 'layer-items' }, ...items.map((x) => h('li', {},
              h('button', { type: 'button', class: sel?.id === x.id ? 'on' : '', disabled: L.locked || !L.visible, onclick: () => { ed.select(x.id); this.setTab('props'); } }, describe(x)))))
          : h('p', { class: 'hint' }, key === 'texts' ? 'Outil « Texte », puis touche le dessin.' : key === 'masks' ? 'Outil « Feutre » : peins sur l’écriture à cacher. « Lire l’écriture » y ajoute aussi ses caches.' : 'Outils « Bulle », « Pensée » ou « Flèche ».'),
      );
    };
    const draw = d.layers.drawing;
    return h('div', { class: 'layers' },
      h('p', { class: 'hint' }, 'Du plus en avant au plus en arrière.'),
      section('texts', 'Textes'),
      section('bubbles', 'Bulles et annotations'),
      section('masks', 'Corrections au feutre'),
      h('section', { class: 'layer' + (draw.visible ? '' : ' hidden') },
        h('header', { class: 'layer-head' },
          h('strong', {}, 'Dessin original'),
          h('span', { class: 'count' }, `${d.width} × ${d.height}`),
          h('button', { type: 'button', class: 'mini', onclick: () => { ed.setLayer('drawing', { visible: !draw.visible }); this.render(); } }, draw.visible ? 'Visible' : 'Masqué')),
        field('Fond de l’image finale', segmented(d.background, [['clean', 'Nettoyé'], ['original', 'Original']], (v) => { ed.setBackground(v); this.render(); })),
        h('p', { class: 'hint' }, 'Le fichier importé n’est jamais modifié : le nettoyage et les textes sont appliqués seulement à l’image finale.')),
    );
  }
}
