# Handoff : blog « Spécimens »

## Vue d'ensemble
Blog BD privé (planches au feutre scannées, dessinées sur ordinateur, ou les deux), *Spécimens — Observations dessinées d'humains en milieu naturel*. On y publie des planches au feutre noir scannées, chacune numérotée comme un « spécimen ». Première série : *La vie des gens du métro*, un guide naturaliste des usagers, avec une fiche espèce par planche. Le lien n'est partagé qu'à la famille et aux amis : pas de comptes, pas de commentaires, aucune donnée personnelle. Le site est pensé d'abord pour le téléphone.

## À propos des fichiers de design
Les fichiers de ce dossier sont des **références de design en HTML** : des prototypes qui montrent l'apparence et le comportement attendus. Ce n'est pas du code de production à copier. La tâche consiste à **recréer ces écrans** dans l'environnement du dépôt cible. Le dépôt est vide : choisis la stack la plus simple adaptée, par exemple un générateur statique (Astro ou Eleventy), du contenu en Markdown/JSON et des images dans `/planches`. Pas de backend : il n'y a ni comptes ni commentaires.

## Fidélité
**Haute fidélité** pour les couleurs, la typographie, les espacements, les textes et les interactions. Les zones hachurées sont des **emplacements d'images** : planches scannées, dessins d'espèces, autoportrait, signatures. Elles seront remplacées par les vrais scans.

## Écrans
Conteneur commun : `max-width: 560px`, centré, marge latérale de 20px, fond `--bg`.

### En-tête (tous les écrans)
- Colonne alignée à gauche, `padding: 22px 20px 6px`, espacement de 14px. Le menu passe **sous** le logo.
- Logo : « SPÉCIMENS » en Shantell Sans 750, capitales, `font-variation-settings:'BNCE' 60,'INFM' 80`, 30px, interligne 1. En dessous, une étiquette en Courier Prime 10px, capitales, espacement 0.06em, fond `--label`, bordure 1px `--ink`, padding 2px 7px, `rotate(-2deg)` : « Observations dessinées d'humains en milieu naturel ». Un clic ramène à l'accueil.
- Menu (flex-wrap, espacement 6px 22px) :
  - « la collection » et « à propos » : liens texte en Shantell Sans 600, 18px, BNCE 40 / INFM 70, sur une seule ligne. Ils sont soulignés d'un trait tremblé en SVG (chemin courbe, trait de 1.8). Trait au repos : `--ink` à 55 % d'opacité. Page active : `--red` à 100 %. Pas de fond, pas de coins arrondis.
  - Bascule de thème : Courier Prime 13px, capitales, `--ink-2`. Pastille ronde de 9px (vide en mode jour, pleine en mode nuit) suivie du libellé « nuit » ou « jour ».

### Accueil
- Ligne d'en-tête : « DERNIÈRE OBSERVATION » (Courier 12px, capitales, espacement 0.08em, `--ink-2`) et « N° 008 » à droite en `--red`. **12px** au-dessus de la planche, pas de vide.
- Planche : pleine largeur, bord à bord, ratio 1/1.414, fond `--sheet`, ombre `--shadow-sheet`. La légende est **sous** l'image, sur fond uni : « planche n°008 — {technique} » en Courier 11px `--ink-2`.
- **État vide** (aucune planche encore) : étiquette de collection « Spécimen n°X » (lettrage 21px) avec « — en cours d'observation » (Courier 13px). Fond `--label`, bordure 1.5px et outline 1px décalé de 3px (double filet), œillet de 8px à gauche, `rotate(-2deg)`. À gauche, une petite flèche bleue dessinée et l'annotation « le feutre chauffe ».
- Titre : lettrage 32px, interligne 1.05. Méta en Courier 12px : « série · obs. le JJ.MM.AAAA · lieu ».
- Liens « observer de plus près → » et « voir toute la collection → » : **lettrage manuscrit** 18px, avec une flèche SVG dessinée.
- « OBSERVÉS RÉCEMMENT » : grille de **2 colonnes**, espacement 26px 16px, 4 miniatures maximum (ratio 1/1.414, N° en rouge, titre en lettrage 15px).

### Planche
- Cartouche de série « accroché » : deux fils SVG (1.2px) partent d'un point central au-dessus. Boîte avec bordure 2px et `--radius-hand`, `rotate(-1.5deg)`, lettrage 15px.
- « SPÉCIMEN N°8 » en Courier 13px `--red`, titre en lettrage 32px, méta « obs. le … · lieu ».
- Planche pleine largeur. En dessous : légende à gauche et emplacement de signature (92×34, pointillé) à droite. La signature change à chaque planche.
- Série métro : lien « lire la fiche espèce → ».
- Précédent / suivant : grille de 2 colonnes, espacement 12px. Boutons avec bordure 2px `--ink` et `--radius-hand` (`--radius-hand-alt` pour « suivant »), rotation de ±0.6°, flèche SVG et lettrage 16px « spécimen précédent » / « spécimen suivant ». Aux extrémités, le bouton devient un cadre pointillé `--line` : « premier spécimen connu » / « dernier spécimen observé ».

### Fiche espèce
- Lien de retour « ← retour à la planche ». Étiquette « FICHE ESPÈCE · SPÉCIMEN N°X » en rouge. Nom de l'espèce en lettrage 34px, puis nom latin en italique Atkinson 17px `--ink-2`.
- Dessin pleine largeur, ratio 4/3, sur fond `--sheet`. Deux annotations en bleu stylo #2F5DA8 (Shantell 500, 15px, BNCE 30 / INFM 90) avec des flèches courbes SVG, sur une petite pastille `--sheet`.
- Liste `<dl>` de 4 rubriques, espacement 22px. Chaque titre est en lettrage 17px, précédé d'une lettre « a. b. c. d. » en Courier 12px rouge ; le texte est décalé de 24px. Rubriques : Habitat, Cri, Comportement en période de rush, Comportement en période de crush.

### La collection
- Titre « LA COLLECTION » en lettrage 34px, compteur « 8 spécimens sous verre ». Onomatopée de décor « TAGADAC » en contour seul (`-webkit-text-stroke` 1.2px), `rotate(-9deg)`, opacité 0.5.
- Filtres : boutons avec bordure 1.5px et `--radius-hand`, lettrage 15px. Pastille de 7px : rouge pleine si le filtre est actif, cercle `--line` sinon. Valeurs : tout / La vie des gens du métro / Hors-série.
- Grille de 2 colonnes, espacement 28px 16px. Chaque miniature porte une étiquette « N° 00X » posée en haut à gauche (rotate -4°, fond `--label`), puis le titre et la date. Filtre sans résultat : « Aucun spécimen observé dans cet habitat pour l'instant. »

### À propos
- « SPÉCIMEN N°0 » / « L'OBSERVATEUR ». Autoportrait dessiné de 260px maximum (pas de photo), deux paragraphes courts, emplacement de signature.

### Pied de page
- Courier 11px `--ink-2`, filet de 60px : « Spécimens — collection privée. » / « Aucun spécimen n'a été dérangé pendant l'observation. »

## Interactions et comportement
- Navigation : logo → accueil ; menu → collection ou à propos ; miniature → planche ; planche → fiche (série métro uniquement) ; fiche → retour à la planche ; précédent / suivant par numéro de spécimen.
- Retour en haut de page à chaque changement d'écran.
- Mode nuit : bascule manuelle, à mémoriser en `localStorage`. La valeur initiale peut suivre `prefers-color-scheme`. **Les planches restent sur fond clair** (`--sheet` ne change pas).
- Survol des liens : couleur `--red`. Focus : prévoir un `outline` visible de 2px en `--ink`. Animations : aucune, sauf éventuellement un fondu de 150ms à l'apparition des images.
- Chargement d'image : « Mise sous verre… ». Page 404 : « Ce spécimen s'est échappé. »
- Images : `srcset` (largeurs 600, 1200 et 1800px), `loading="lazy"` sauf pour la planche du haut. Texte alternatif obligatoire : description du dessin.
- Confidentialité : `<meta name="robots" content="noindex,nofollow">`, pas d'analytics ni de traceurs, fichier robots.txt qui interdit tout. Ajouter une protection par mot de passe simple si l'hébergeur le permet.

## Modèle de contenu
```
specimen { n:int, series:'metro'|'hs', tech:'feutre'|'numerique'|'mixte', title, latin?, date:'JJ.MM.AAAA', lieu (générique), image, alt, signature?, pending?:bool,
           fiche?: { habitat, cri, rush, crush, annotations:[{text, x%, y%}] } }
```
`tech` donne la légende : feutre → « feutre noir sur papier, scanné », numerique → « dessin numérique », mixte → « feutre scanné, texte tapé ».
Un spécimen avec `pending: true` s'affiche comme l'étiquette « en cours d'observation ».

## Design tokens
Voir `tokens/tokens.css`.
- Couleurs : papier #FAF7F0, feuille #FFFDF8, étiquette #F2EDE2, feutre #1A1816, mine #4A4640, trait fin #8A847A (jamais pour du texte), filet #D9D3C7, rouge pommettes #C23B30, bleu stylo #2F5DA8, jaune surligneur #F4D35E (un mot au maximum).
- Mode sombre : fond #1B1917, texte #F1ECE2, texte secondaire #B9B2A6, ligne #6A645B, étiquette #26231F, rouge #EC7A68, bleu #93B2E8.
- Polices : Shantell Sans (lettrage provisoire, en attendant le lettrage scanné de l'auteur), Atkinson Hyperlegible (texte courant), Courier Prime (étiquettes). Toutes viennent de Google Fonts ; les auto-héberger en production.
- Échelle typographique : 34 / 32 / 18 / 17 / 15 / 13 / 12 / 11 px.
- Espacements : 4, 8, 12, 16, 22, 28, 44, 56 px ; marge de page 20px.
- Rayons « à la main » : `255px 14px 225px 14px / 14px 225px 14px 255px` et sa variante.
- Ombre de feuille : `0 1px 0 rgba(26,24,22,.08), 0 10px 26px -16px rgba(26,24,22,.35)`.

## Préparation des planches
- Scan : 600 dpi, fond nettoyé vers #FFFDF8, noirs ramenés à #1A1816.
- Numérique : canevas A4 (2480 × 3508), fond #FFFDF8, brosse type feutre sans lissage, pas de couleur hors des accents.
- Texte tapé dans les planches : Shantell Sans en capitales pour les bulles, Courier Prime pour les légendes.
- Export web : WebP ou AVIF, plus grand côté 1800px ; prévoir une passe d'optimisation dans le build.

## Assets
Aucun asset final n'est fourni. À produire par l'auteur : les scans des planches (A4 portrait, feutre noir), les dessins d'espèces, l'autoportrait de dos, une signature par planche et, idéalement, le logo et les cartouches lettrés à la main. Les flèches et les soulignements sont de simples chemins SVG, définis dans les prototypes.

## Fichiers
- `SpecimensBlog.dc.html` : prototype mobile interactif (5 écrans, mode nuit, état vide). Pour le voir hors de l'outil, consulter le code source ; les styles sont tous en ligne.
- `Guide de marque.dc.html` : guide de marque (principes, logo, couleurs, typographie, éléments, ton, écrans).
- `tokens/tokens.css` : variables CSS.
- `ISSUES.md` : découpage proposé en tickets GitHub.
