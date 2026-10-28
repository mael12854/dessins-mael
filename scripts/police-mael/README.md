# Police « Mon écriture (Maël) »

Sources :
- `Maelhandwritten-Regular-calligraphr.ttf` : police brute faite avec Calligraphr ;
- `grille-complements-2026-10-28.jpg` : page de grille scannée avec les capitales accentuées, à â è…, « », les chiffres, ™ et ©.

Fabrication de `public/fonts/maelhandwritten.woff` :

```sh
pip install fonttools shapely potracer pillow numpy
python3 scripts/police-mael/trace_scan.py scripts/police-mael/grille-complements-2026-10-28.jpg scripts/police-mael/grille-complements.json
python3 scripts/police-mael/build.py scripts/police-mael/Maelhandwritten-Regular-calligraphr.ttf /tmp/mael scripts/police-mael/grille-complements.json
cp /tmp/mael.woff public/fonts/maelhandwritten.woff
```

`trace_scan.py` vectorise les cases de la grille (positions des cases et caractères listés en haut du script, à adapter pour un autre scan).
`build.py` :
- retire les taches et petits traits parasites ;
- pose les capitales et les chiffres sur une même ligne, à la même hauteur, et égalise l'épaisseur du trait ;
- réduit le point et le pose sur la ligne ; remet le ë à la taille du e ;
- prend les lettres de la grille en priorité ; compose Ï Û Ü ï û ü avec les accents de Maël ;
- pose les minuscules sur une même ligne (sans changer leur taille) ;
- écriture attachée : les minuscules qui finissent en bas à droite reçoivent une variante avec une courte liaison,
  employée seulement quand une minuscule suit (fonction OpenType `calt`), puis chaque paire de minuscules est
  rapprochée jusqu'à ce que les traits se touchent, sans écraser les corps des lettres (crénage `kern`).
  Les lettres qui finissent en haut (c o v w b r) ou ont un jambage (g j p q y z f) n'ont pas de liaison.

Encore à dessiner : - – ( ) … / & @ € % ° · œ æ Œ Æ. En attendant, Gochi Hand les remplace dans le Studio.
