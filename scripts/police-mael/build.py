# Construit la police « Maelhandwritten » pour le Studio à partir du fichier Calligraphr d'origine.
# Usage : python3 -I build.py original.ttf sortie_base
# 1. retire les petits traits parasites (restes des cases du modèle) ;
# 2. pose les capitales sur une même ligne de base, à la même hauteur (tracés et proportions gardés) ;
# 3. corrige le point, la ponctuation et le ë ;
# 4. reconstruit les capitales accentuées (À É È…) avec la capitale + l'accent dessiné par Maël,
#    et compose les accents absents (ê î û ï ü Ê Î Û Ï Ü) avec ses propres accents ;
# 5. régularise l'espace autour de chaque caractère.
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, out = sys.argv[1], sys.argv[2]
f = TTFont(src)
glyf, hmtx = f['glyf'], f['hmtx']
cmap = f.getBestCmap()
SIDE = 45          # approche de chaque côté (sur 1000)
CAP_H = 480        # hauteur des capitales
X_BOTTOM, X_H = 0, 230  # minuscules : ligne de base et hauteur d'x visées pour ë (alignées sur e)
log = []

# ——— Contours ———
def read(gname):
    g = glyf[gname]
    if g.isComposite() or g.numberOfContours <= 0: return []
    co, ends, flags = g.getCoordinates(glyf)
    res, s = [], 0
    for e in ends:
        res.append({'pts': [tuple(p) for p in co[s:e + 1]], 'on': [bool(x & 1) for x in flags[s:e + 1]]}); s = e + 1
    return res
def box(cs):
    xs = [x for c in cs for x, _ in c['pts']]; ys = [y for c in cs for _, y in c['pts']]
    return (min(xs), min(ys), max(xs), max(ys))
def sarea(c):
    p = c['pts']; return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2
def area(c):
    p = c['pts']; return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2
inside = lambda b, B: b[0] >= B[0] and b[1] >= B[1] and b[2] <= B[2] and b[3] <= B[3]
def tf(cs, k=1.0, dx=0.0, dy=0.0, ox=0.0, oy=0.0):
    """Mise à l'échelle k autour de (ox, oy), puis décalage."""
    return [{'pts': [((x - ox) * k + ox + dx, (y - oy) * k + oy + dy) for x, y in c['pts']], 'on': c['on']} for c in cs]
def write(gname, cs):
    pen = TTGlyphPen(None)
    for c in cs:
        pts, on = c['pts'], c['on']
        st = next((i for i in range(len(pts)) if on[i]), None)
        if st is None:  # contour sans point « on » : on part du milieu de deux points « off »
            pts = [((pts[-1][0] + pts[0][0]) / 2, (pts[-1][1] + pts[0][1]) / 2)] + pts; on = [True] + on; st = 0
        seq, ons = pts[st:] + pts[:st], on[st:] + on[:st]
        pen.moveTo(seq[0]); buf = []
        for p, o in zip(seq[1:], ons[1:]):
            if o: (pen.qCurveTo(*buf, p) if buf else pen.lineTo(p)); buf = []
            else: buf.append(p)
        if buf: pen.qCurveTo(*buf, seq[0])
        pen.closePath()
    glyf[gname] = pen.glyph()
G = {}  # caractère → contours (travail)
name_of = {}
for code, g in cmap.items():
    G[chr(code)] = read(g); name_of[chr(code)] = g

# ——— 1. traits parasites ———
for ch, cs in G.items():
    keep = []
    for c in cs:
        b = box([c])
        isolated = not any(inside(b, box([o])) for o in cs if o is not c)
        flat = area(c) < 600 and b[3] - b[1] <= 15
        # lettres sans point ni accent : un petit élément isolé est une tache (ex. les points au-dessus du W)
        # (un trou de lettre est tracé dans l'autre sens que le contour principal : on le garde)
        big = max(cs, key=area)
        same_way = (sarea(c) > 0) == (sarea(big) > 0)
        stray = ch.isascii() and ch.isalpha() and ch not in 'ij' and c is not big and same_way and area(c) < 0.06 * area(big)
        if (isolated and flat) or stray:
            log.append(f'trait parasite retiré dans {ch!r}')
        else: keep.append(c)
    G[ch] = keep

# Corps d'une lettre (plus grand contour + ses trous) / accent (le reste, au-dessus du corps)
def split(cs):
    big = max(cs, key=area); B = box([big])
    body = [c for c in cs if c is big or inside(box([c]), B)]
    rest = [c for c in cs if not any(c is b for b in body)]
    return body, rest
def above(cs, ref_box):
    return [c for c in cs if box([c])[1] > (ref_box[1] + ref_box[3]) / 2]

# ——— 2. capitales sur une même ligne ———
def norm_cap(cs):
    b = box(cs); k = CAP_H / (b[3] - b[1])
    return tf(cs, k, dx=0, dy=-b[1] * k, ox=0, oy=0)
for ch in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
    G[ch] = norm_cap(G[ch])
log.append(f'capitales A–Z posées sur la ligne, hauteur {CAP_H}')

# ——— 3. ponctuation et ë ———
def place(cs, height, bottom):
    b = box(cs); k = height / (b[3] - b[1]); return tf(cs, k, dy=bottom - b[1] * k)
dot = G['.']; b = box(dot)
G['.'] = place(dot, (b[3] - b[1]) * 0.5, 0); log.append('point réduit de moitié, posé sur la ligne')
for ch, h in (('!', CAP_H), ('?', CAP_H)):
    G[ch] = place(G[ch], h, 0)
cb = box(G[':']); k_colon = (CAP_H * 0.62) / (cb[3] - cb[1])
G[':'] = place(G[':'], CAP_H * 0.62, 0)
# point-virgule : même échelle que les deux-points, haut aligné sur le leur
semi = tf(G[';'], k_colon); G[';'] = tf(semi, dy=box(G[':'])[3] - box(semi)[3])
G[','] = place(G[','], (box(G[','])[3] - box(G[','])[1]) * 0.6, -110)

# minuscules de référence : e
eb = box(G['e'])
def norm_lower_like_e(ch, base='e'):
    body, rest = split(G[ch]); bb = box(body); rb = box(G[base])
    k = (rb[3] - rb[1]) / (bb[3] - bb[1]); dy = rb[1] - bb[1] * k
    return tf(body + rest, k, dy=dy)
G['ë'] = norm_lower_like_e('ë'); log.append('ë remis à la taille et à la hauteur du e')

# ——— 4. accents ———
def accent_of(ch):
    body, rest = split(G[ch]); return above(rest, box(body))
def with_accent(base_cs, acc, gap=40, scale=1.0):
    bb = box(base_cs); ab = box(acc)
    cx = (bb[0] + bb[2]) / 2; acx = (ab[0] + ab[2]) / 2
    a = tf(acc, scale, ox=acx, oy=ab[1])
    ab2 = box(a)
    return base_cs + tf(a, 1, dx=cx - (ab2[0] + ab2[2]) / 2, dy=bb[3] + gap - ab2[1])
def lower_body(ch):  # lettre sans son accent ni son point
    body, _ = split(G[ch]); return body
grave, acute, circ, uml = accent_of('è'), accent_of('é'), accent_of('â'), accent_of('ë')
built = []
for cap, base, acc in (('À', 'A', accent_of('à')), ('Â', 'A', circ), ('È', 'E', grave), ('É', 'E', acute),
                       ('Ê', 'E', circ), ('Ë', 'E', uml), ('Î', 'I', circ), ('Ï', 'I', uml), ('Ò', 'O', accent_of('ò')),
                       ('Ô', 'O', circ), ('Ö', 'O', uml), ('Ù', 'U', accent_of('ù')), ('Û', 'U', circ), ('Ü', 'U', uml)):
    G[cap] = with_accent(G[base], acc, gap=45); built.append(cap)
for low, base, acc in (('ê', 'e', circ), ('î', 'i', circ), ('ï', 'i', uml), ('û', 'u', circ), ('ü', 'u', uml)):
    G[low] = with_accent(lower_body(base), acc, gap=35); built.append(low)
log.append('accents construits avec les accents de Maël : ' + ''.join(built))

# ——— 5. épaisseur du trait égalisée ———
# La mise à taille rend fines les lettres réduites (A) et épaisses les lettres agrandies (K, M).
# Épaisseur moyenne d'un trait ≈ 2 × surface / périmètre ; on élargit ou amincit le contour d'autant.
from shapely.geometry import Polygon, MultiPolygon
from shapely.geometry.polygon import orient
def flatten(c, steps=8):
    pts, on = c['pts'], c['on']; n = len(pts)
    st = next((i for i in range(n) if on[i]), None)
    if st is None:
        pts = [((pts[-1][0] + pts[0][0]) / 2, (pts[-1][1] + pts[0][1]) / 2)] + pts; on = [True] + on; st = 0; n += 1
    seq, ons = pts[st:] + pts[:st], on[st:] + on[:st]
    seq.append(seq[0]); ons.append(True)
    outp = [seq[0]]; i = 0
    while i < len(seq) - 1:
        if ons[i + 1]: outp.append(seq[i + 1]); i += 1; continue
        # suite de points « off » : points « on » implicites au milieu
        j = i + 1; offs = []
        while not ons[j]: offs.append(seq[j]); j += 1
        start = outp[-1]
        for k, ctrl in enumerate(offs):
            end = seq[j] if k == len(offs) - 1 else ((ctrl[0] + offs[k + 1][0]) / 2, (ctrl[1] + offs[k + 1][1]) / 2)
            for t in range(1, steps + 1):
                u = t / steps
                outp.append(((1 - u) ** 2 * start[0] + 2 * (1 - u) * u * ctrl[0] + u * u * end[0],
                             (1 - u) ** 2 * start[1] + 2 * (1 - u) * u * ctrl[1] + u * u * end[1]))
            start = end
        i = j
    return outp
def shape(cs):
    geo = None
    for c in cs:
        pl = Polygon(flatten(c)).buffer(0)
        geo = pl if geo is None else geo.symmetric_difference(pl)
    return geo
def weight(geo): return 2 * geo.area / geo.length if geo.length else 0
def from_shape(geo):
    polys = [geo] if isinstance(geo, Polygon) else [g for g in getattr(geo, 'geoms', []) if isinstance(g, Polygon)]
    res = []
    for pg in polys:
        pg = orient(pg, sign=-1.0)  # TrueType : extérieur dans le sens horaire
        for ring in [pg.exterior, *pg.interiors]:
            co = list(ring.coords)[:-1]
            if len(co) >= 3: res.append({'pts': [(round(x), round(y)) for x, y in co], 'on': [True] * len(co)})
    return res
shapes = {ch: shape(cs) for ch, cs in G.items() if cs}
letters = [weight(shapes[ch]) for ch in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
TARGET = sorted(letters)[len(letters) // 2] * 1.15  # un peu plus marqué que la médiane, comme un feutre
for ch, geo in shapes.items():
    w = weight(geo); d = max((TARGET - w) / 2, -w * 0.3)
    g2 = geo.buffer(d, join_style=1, quad_segs=4).simplify(0.6)
    if not g2.is_empty: G[ch] = from_shape(g2)
log.append(f'épaisseur du trait égalisée à {TARGET:.0f} (avant : {min(letters):.0f} à {max(letters):.0f})')

# ——— 6. écriture, glyphes nouveaux, approches ———
order = f.getGlyphOrder()
written = set()
for ch, cs in G.items():
    if not cs: continue
    if ch in name_of and name_of[ch] in written:  # glyphe partagé (À et à) : la capitale a son propre dessin
        del name_of[ch]
    if ch not in name_of:
        gname = f'uni{ord(ch):04X}'; order.append(gname); name_of[ch] = gname
        for t in f['cmap'].tables:
            if t.isUnicode(): t.cmap[ord(ch)] = gname
    b = box(cs)
    cs = tf(cs, dx=SIDE - b[0])
    write(name_of[ch], cs)
    hmtx[name_of[ch]] = (int(round(b[2] - b[0] + 2 * SIDE)), SIDE)
    written.add(name_of[ch])
f.setGlyphOrder(order)
f['maxp'].numGlyphs = len(order)
f['name'].setName('Maelhandwritten', 1, 3, 1, 0x409)
f['name'].setName('Maelhandwritten Regular', 4, 3, 1, 0x409)
f.save(out + '.ttf'); f.flavor = 'woff'; f.save(out + '.woff')
print('\n'.join(log))
