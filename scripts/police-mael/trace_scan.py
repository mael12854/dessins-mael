# Vectorise les cases d'une grille Calligraphr scannée (page de compléments) en contours.
# Usage : python3 trace_scan.py scan.jpg sortie.json
# Positions des cases mesurées sur le scan du 28.10.2026 à 13 h 47 (1723 × 2387 px, 172 ppp).
import json, sys
import numpy as np
from PIL import Image
import potrace

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('L')
X = [127, 291, 456, 622, 787, 950, 1113, 1276, 1440]   # traits verticaux
# Zones de dessin (sous la bande d'étiquette), mesurées vers x = 235 ; la feuille penche :
# les lignes remontent de 16 px entre x = 235 et x = 1425.
ROWS = [(220, 396), (430, 604), (638, 812), (845, 1020), (1053, 1228), (1262, 1436), (1470, 1646)]
SKEW = -16 / 1190
# Caractère dessiné dans chaque case. None = case ignorée. « 1b » = seconde version d'un caractère.
CELLS = [
    [None, None, '«', None, None],          # z : sa boucle touche le trait de la grille, on garde l'ancien
    ['»', 'À', 'Â', 'Ç', 'È'],
    ['É', 'Ê', 'Ë', 'Î', 'Ò', 'Ô', 'Ö', 'Ù'],
    ['à', 'â', None, 'è', 'é', 'ê', 'ë', 'î'],
    ['ò', 'ô', 'ö', 'ù', None, 'Çb', '0b', '1b'],
    ['1', '2', '3', '4', '4b', '5', '5b', '6'],
    ['7', '8', '9', '0', '™', '©', None, None],
]
UP = 3        # agrandissement avant tracé (contours plus lisses)
INSET = 9     # marge pour ne pas prendre les bords de case
res = {}
for r, (y0, y1) in enumerate(ROWS):
    for c, ch in enumerate(CELLS[r]):
        if not ch: continue
        dy = round(((X[c] + X[c + 1]) / 2 - 235) * SKEW)
        cell = im.crop((X[c] + INSET, y0 + dy + INSET, X[c + 1] - INSET, y1 + dy - INSET))
        cell = cell.resize((cell.width * UP, cell.height * UP), Image.BICUBIC)
        a = np.asarray(cell).astype(int)
        # potracer trace les pixels « faux » : on lui passe donc le fond à True.
        # Seuil 140 : l'encre passe, les lignes guides grises restent dans le fond.
        bm = potrace.Bitmap(a >= 140)
        path = bm.trace(turdsize=12 * UP * UP, alphamax=1.0, opticurve=True, opttolerance=0.3)
        H = a.shape[0]
        P = lambda q: (q.x, q.y) if hasattr(q, 'x') else tuple(q)
        contours = []
        for curve in path:
            pts = [P(curve.start_point)]
            for seg in curve.segments:
                if seg.is_corner:
                    pts += [P(seg.c), P(seg.end_point)]
                else:  # courbe de Bézier cubique, aplatie
                    p0 = pts[-1]
                    for t in range(1, 9):
                        u = t / 8
                        pts.append(tuple((1 - u) ** 3 * p0[i] + 3 * (1 - u) ** 2 * u * P(seg.c1)[i] + 3 * (1 - u) * u * u * P(seg.c2)[i] + u ** 3 * P(seg.end_point)[i] for i in (0, 1)))
            xs = [x for x, _ in pts]; ys = [y for _, y in pts]
            if (max(ys) - min(ys)) < 10 * UP and (max(xs) - min(xs)) > 40 * UP:
                continue  # morceau de trait de la grille (long et plat)
            if (max(ys) > H - 3 * UP or min(ys) < 3 * UP) and (max(ys) - min(ys)) < 12 * UP:
                continue  # reste de trait de grille collé au bord de la case
            contours.append([[round(x / UP, 2), round((H - y) / UP, 2)] for x, y in pts])  # y vers le haut
        res[ch] = contours
json.dump(res, open(out, 'w'))
print({k: len(v) for k, v in res.items()})
