# Construit la police « Maelhandwritten » pour le Studio à partir du fichier Calligraphr d'origine.
# Usage : python3 -I build.py original.ttf sortie_base [grille.json]
#   grille.json : lettres d'une grille scannée en plus (voir trace_scan.py), prioritaires sur l'original.
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
scan_file = sys.argv[3] if len(sys.argv) > 3 else None
f = TTFont(src)
glyf, hmtx = f['glyf'], f['hmtx']
cmap = f.getBestCmap()
SIDE = 45          # approche de chaque côté (sur 1000) : capitales, chiffres, ponctuation
# Minuscules attachées : approche nulle, puis crénage paire par paire (étape 7) pour que les traits se touchent.
import os
SIDE_LOW = int(os.environ.get('SIDE_LOW', '0'))
joined = lambda ch: ch.isalpha() and ch.islower()
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

# ——— 2 bis. minuscules sur une même ligne (sans changer leur taille) ———
# Dans le fichier Calligraphr, chaque minuscule flotte à sa hauteur (bas du a à 55, du u à 98…) :
# les liaisons de l'écriture attachée passeraient sous la lettre suivante.
def core(cs):  # sans les points et accents (éléments situés en haut)
    b = box(cs); mid = (b[1] + b[3]) / 2
    return [c for c in cs if box([c])[1] < mid] or cs
X_LETTERS, ASC, DESC = 'acemnorsuvwxi', 'bdhklt', 'gjpqyz'
for ch in X_LETTERS + ASC:
    G[ch] = tf(G[ch], dy=-box(core(G[ch]))[1])
XH = sorted(box(core(G[ch]))[3] for ch in X_LETTERS if ch != 'i')[len(X_LETTERS) // 2 - 1]
for ch in DESC:  # le haut du corps à la hauteur des minuscules
    G[ch] = tf(G[ch], dy=XH - box(core(G[ch]))[3])
asc_top = sorted(box(G[ch])[3] for ch in ASC)[len(ASC) // 2]
G['f'] = tf(G['f'], dy=asc_top - box(G['f'])[3])
log.append(f'minuscules posées sur la ligne (hauteur d’x {XH:.0f})')

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

# ——— 3 bis. lettres de la grille scannée (vraies capitales accentuées, à â è…, « ») ———
scanned = set()
if scan_file:
    import json
    raw = json.load(open(scan_file))
    def contours_of(lst): return [{'pts': [tuple(p) for p in c], 'on': [True] * len(c)} for c in lst if len(c) >= 3]
    # Cases en double : version retenue (0 étroit pour ne pas le confondre avec O, 1 simple).
    for ch, alt in (('0', '0b'), ('1', '1b')):
        if alt in raw: raw[ch] = raw[alt]
    raw = {k: v for k, v in raw.items() if not k.endswith('b')}
    BASE = {'à': 'a', 'â': 'a', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'î': 'i', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'ù': 'u'}
    for ch, lst in raw.items():
        cs = contours_of(lst)
        if not cs: continue
        if ch == 'Ç':  # C et cédille d'un seul trait : largeur du C, haut sur la ligne des capitales
            b = box(cs); cb = box(G['C']); k = (cb[2] - cb[0]) / (b[2] - b[0])
            G[ch] = tf(cs, k, dy=CAP_H - b[3] * k)
        elif ch.isupper():  # capitale : corps (sans l'accent) à la hauteur des capitales, posé sur la ligne
            body, _ = split(cs); bb = box(body); k = CAP_H / (bb[3] - bb[1])
            G[ch] = tf(cs, k, dy=-bb[1] * k)
        elif ch in BASE:   # minuscule : corps à la taille et à la hauteur de la lettre de base
            body, _ = split(cs); bb = box(body); rb = box(split(G[BASE[ch]])[0])
            k = (rb[3] - rb[1]) / (bb[3] - bb[1]); G[ch] = tf(cs, k, dy=rb[1] - bb[1] * k)
        elif ch.isdigit():  # chiffres : hauteur des capitales, sur la ligne
            b = box(cs); k = CAP_H / (b[3] - b[1]); G[ch] = tf(cs, k, dy=-b[1] * k)
        elif ch == '™':      # petit, en haut
            b = box(cs); k = CAP_H * 0.3 / (b[3] - b[1]); G[ch] = tf(cs, k, dy=CAP_H - b[3] * k)
        elif ch == '©':
            b = box(cs); k = CAP_H * 0.8 / (b[3] - b[1]); G[ch] = tf(cs, k, dy=-b[1] * k)
        elif ch in '«»':   # guillemets : petits, au milieu de la hauteur des capitales
            b = box(cs); k = CAP_H * 0.42 / (b[3] - b[1]); G[ch] = tf(cs, k, dy=CAP_H * 0.2 - b[1] * k)
        else: continue
        scanned.add(ch)
    log.append('lettres prises dans la grille scannée : ' + ''.join(sorted(scanned)))

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
    if cap in scanned: continue
    G[cap] = with_accent(G[base], acc, gap=45); built.append(cap)
for low, base, acc in (('ê', 'e', circ), ('î', 'i', circ), ('ï', 'i', uml), ('û', 'u', circ), ('ü', 'u', uml)):
    if low in scanned: continue
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
FINAL = {}
for ch, cs in G.items():
    if not cs: continue
    if ch in name_of and name_of[ch] in written:  # glyphe partagé (À et à) : la capitale a son propre dessin
        del name_of[ch]
    if ch not in name_of:
        gname = f'uni{ord(ch):04X}'; order.append(gname); name_of[ch] = gname
        for t in f['cmap'].tables:
            if t.isUnicode(): t.cmap[ord(ch)] = gname
    b = box(cs)
    side = SIDE_LOW if joined(ch) else SIDE
    cs = tf(cs, dx=side - b[0])
    write(name_of[ch], cs)
    hmtx[name_of[ch]] = (int(round(b[2] - b[0] + 2 * side)), side)
    written.add(name_of[ch])
    FINAL[ch] = (cs, hmtx[name_of[ch]][0])
f.setGlyphOrder(order)
f['maxp'].numGlyphs = len(order)

# ——— 7. écriture attachée : liaisons et crénage paire par paire ———
# Chaque minuscule reçoit une variante « .join » avec un court trait de sortie, partant de son point le plus
# à droite. La police ne l'emploie (fonction calt) que si une minuscule suit : la fin des mots reste nette.
# Puis on rapproche chaque paire jusqu'à ce que la liaison touche la lettre suivante, sans écraser les corps.
from shapely.geometry import LineString
BIN = 8
def profile(cs):
    lo, hi = {}, {}
    for c in cs:
        pts = c['pts']
        for i in range(len(pts)):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
            n = max(1, int(max(abs(x2 - x1), abs(y2 - y1)) / 4))
            for k in range(n + 1):
                x = x1 + (x2 - x1) * k / n; y = y1 + (y2 - y1) * k / n; bi = int(y // BIN)
                lo[bi] = min(lo.get(bi, x), x); hi[bi] = max(hi.get(bi, x), x)
    return lo, hi
TOUCH = round(TARGET * 0.45)   # léger chevauchement : les deux traits se fondent
# Bande du milieu (corps des lettres) : écart minimum à garder entre deux corps.
eb = box(FINAL['e'][0]); XB, XT = eb[1] + 0.3 * (eb[3] - eb[1]), eb[1] + 0.8 * (eb[3] - eb[1])
BODY_GAP = int(os.environ.get('BODY_GAP', '35'))
TAIL = BODY_GAP + TOUCH + int(os.environ.get('TAIL_EXTRA', '10'))   # longueur de la liaison au-delà du point le plus à droite
lows = [ch for ch in FINAL if joined(ch)]
JOIN = {}
for ch in lows:
    cs, adv = FINAL[ch]
    cand = [c for c in cs if box([c])[1] < XT]           # sans les accents ni les points
    pts = [p for c in cand for p in c['pts']]
    low_pts = [p for p in pts if eb[1] - 20 <= p[1] <= XB]   # bas de la lettre, là où part la liaison
    gb = box(cand)
    # Liaison seulement si le trait finit vraiment en bas à droite (pas pour les jambages g j p q y z f,
    # ni pour les lettres qui finissent en haut comme c o v w b r : elles se collent par le crénage seul).
    if not low_pts or ch in 'gjpqyzfçcovwbr' or max(p[0] for p in low_pts) < gb[2] - 0.15 * (gb[2] - gb[0]):
        JOIN[ch] = (cs, adv); continue
    xr, yr = max(low_pts, key=lambda p: (p[0], -p[1]))
    tail = LineString([(xr - TARGET, yr), (xr + TAIL, yr)]).buffer(TARGET / 2, quad_segs=4)
    geo = shape(cs).union(tail).simplify(0.6)
    JOIN[ch] = (from_shape(geo), adv)
order = f.getGlyphOrder()
for ch, (cs, adv) in JOIN.items():
    g = name_of[ch] + '.join'; order.append(g); write(g, cs); hmtx[g] = (adv, int(box(cs)[0]))
f.setGlyphOrder(order); f['maxp'].numGlyphs = len(order)

base_prof = {ch: profile(FINAL[ch][0]) for ch in lows}
join_prof = {ch: profile(JOIN[ch][0]) for ch in lows}
pairs = []
for a in lows:
    adv = FINAL[a][1]; hiJ = join_prof[a][1]; hiB = base_prof[a][1]
    for bch in lows:
        loB = base_prof[bch][0]
        common = set(hiJ) & set(loB)
        if not common: continue
        kern = -min(adv - hiJ[k] + loB[k] for k in common) - TOUCH          # la liaison touche la lettre suivante
        mid = [k for k in set(hiB) & set(loB) if XB <= k * BIN <= XT]
        if mid:  # corps (sans liaison) jamais plus proches que BODY_GAP
            kern = max(kern, BODY_GAP - min(adv - hiB[k] + loB[k] for k in mid))
        kern = int(round(max(-260, min(120, kern))))
        if abs(kern) >= 4:
            pairs.append((name_of[a] + '.join', name_of[bch], kern))
            pairs.append((name_of[a] + '.join', name_of[bch] + '.join', kern))
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
low = ' '.join(name_of[c] for c in lows)
fea = ('languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n'
       f'@LOW = [{low}];\n@LOWJ = [{" ".join(name_of[c] + ".join" for c in lows)}];\n'
       'lookup TOJOIN { sub @LOW by @LOWJ; } TOJOIN;\n'
       "feature calt { sub @LOW' lookup TOJOIN @LOW; } calt;\n"
       'feature kern {\n' + ''.join(f'  pos {x} {y} {k};\n' for x, y, k in pairs) + '} kern;\n')
addOpenTypeFeaturesFromString(f, fea)
log.append(f'écriture attachée : {sum(JOIN[c][0] is not FINAL[c][0] for c in JOIN)} minuscules avec liaison, {len(pairs) // 2} paires rapprochées')
f['name'].setName('Maelhandwritten', 1, 3, 1, 0x409)
f['name'].setName('Maelhandwritten Regular', 4, 3, 1, 0x409)
f.save(out + '.ttf'); f.flavor = 'woff'; f.save(out + '.woff')
print('\n'.join(log))
