# Police « Mon écriture (Maël) »

`Maelhandwritten-Regular-calligraphr.ttf` est la police brute faite avec Calligraphr. `build.py` la nettoie pour le Studio et produit `public/fonts/maelhandwritten.woff` :

- retire les taches et petits traits parasites (restes du modèle scanné) ;
- pose les capitales A–Z sur une même ligne, à la même hauteur, et égalise l'épaisseur du trait ;
- réduit le point et le pose sur la ligne ; remet le ë à la taille du e ;
- reconstruit À Â È É Ê Ë Î Ï Ò Ô Ö Ù Û Ü et ê î ï û ü avec les accents dessinés par Maël.

Après une nouvelle grille Calligraphr, remplacer le .ttf puis :

```sh
pip install fonttools shapely
python3 scripts/police-mael/build.py scripts/police-mael/Maelhandwritten-Regular-calligraphr.ttf /tmp/mael
cp /tmp/mael.woff public/fonts/maelhandwritten.woff
```

À dessiner dans la prochaine grille : chiffres 0–9, - – ( ) « » … / & @ € % °, œ æ Œ Æ, Ç et ç. En attendant, Gochi Hand les remplace dans le Studio.
