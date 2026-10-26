# Spécimens

*Observations dessinées d’humains en milieu naturel.*
Blog BD, pensé d’abord pour le téléphone. Site statique fait avec [Astro](https://astro.build) : pas de base de données, pas de comptes, pas de commentaires, pas d’analytics.

## Ajouter un spécimen

Chaque spécimen est un dossier dans `specimens/`, avec un fichier `index.md` et ses images à côté :

```
specimens/
  009-la-dormeuse-de-terminus/
    index.md
    planche.jpg      ← le scan (A4 portrait, 1800px ou plus de haut)
    espece.jpg       ← dessin de la fiche espèce (4/3), optionnel
    signature.png    ← signature de cette planche, optionnelle
```

`index.md` :

```yaml
---
n: 9                       # numéro du spécimen (unique)
series: metro              # metro = La vie des gens du métro · hs = Hors-série
tech: feutre               # feutre | numerique | mixte → légende sous la planche
title: "La Dormeuse de terminus"
latin: "Somnolenta terminalis"
date: "02.11.2026"         # JJ.MM.AAAA
lieu: "rame"               # lieu générique, jamais d'adresse
image: ./planche.jpg
alt: "Une femme endormie contre la vitre, sac serré contre elle."   # obligatoire avec une image
signature: ./signature.png
# pending: true            # affiche l'étiquette « en cours d'observation » au lieu de la planche
fiche:                     # série métro uniquement
  image: ./espece.jpg
  alt: "La dormeuse, de profil."
  habitat: "…"
  cri: "…"
  rush: "…"
  crush: "…"
  annotations:             # 4 max, position en % du dessin (x de gauche à droite, y de haut en bas)
    - { text: "bouche entrouverte", x: 94, y: 14 }
    - { text: "réveil au terminus", x: 6, y: 88 }
---
```

Sans `image`, la planche s’affiche comme un emplacement hachuré. Les images sont converties en WebP (600, 1200 et 1800px) au moment du build.

Les spécimens n°1 à 8 sont les **exemples de la maquette** (sans images) : à remplacer par les vrais.

Autoportrait et signature de la page « à propos » : déposer `src/assets/autoportrait.jpg` (carré) et `src/assets/signature.png`.

## Lancer en local

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # site statique dans dist/
```

## Mise en ligne

Sur Vercel : importer ce dépôt, Vercel détecte Astro tout seul. Chaque push sur `main` republie le site.

Référencement : le site est public et indexable par Google. `robots.txt` autorise tout et pointe vers le sitemap (`/sitemap-index.xml`, généré au build). Chaque page a une description et une URL canonique. Si l'adresse du site change (nom de domaine perso), modifier `site` dans `astro.config.mjs` et la ligne `Sitemap:` de `public/robots.txt`.

Aucun traceur, polices auto-hébergées (aucun appel à Google Fonts).

## Design

Les maquettes et le guide de marque viennent de Claude Design (`Spécimens design system`). Tokens dans `src/styles/tokens.css`. Polices : Shantell Sans (lettrage provisoire en attendant le lettrage de l’auteur), Atkinson Hyperlegible, Courier Prime.
