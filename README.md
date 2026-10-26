# Spécimens

*Observations dessinées d’humains en milieu naturel.*
Blog BD, pensé d’abord pour le téléphone. Site statique fait avec [Astro](https://astro.build) : pas de base de données (les spécimens sont des fichiers dans ce dépôt), pas de comptes, pas de commentaires, pas d’analytics. Seule l’API d’admin (`/api/admin`) tourne sur le serveur.

## Ajouter un spécimen

### Depuis le téléphone : `/admin`

Aller sur `https://dessins-mael.vercel.app/admin`, entrer le code d’accès, puis « + Nouveau spécimen ». On peut aussi modifier ou retirer un spécimen existant. Les images sont réduites dans le navigateur avant l’envoi. Chaque enregistrement crée un commit dans ce dépôt ; Vercel republie le site en une minute environ.

Variables d’environnement Vercel nécessaires :

| Variable | Rôle |
| --- | --- |
| `ADMIN_PASSWORD` | code d’accès de `/admin` |
| `GITHUB_TOKEN` | jeton GitHub *fine-grained*, limité à ce dépôt, permission **Contents : Read and write** |
| `GITHUB_REPO` | facultatif, `mael12854/dessins-mael` par défaut |
| `GITHUB_BRANCH` | facultatif, `main` par défaut |

Après un changement de variable, redéployer le site (Vercel → Deployments → Redeploy).

### À la main

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

Sans `image`, la planche s’affiche comme un emplacement hachuré. Sans aucun spécimen, l’accueil affiche « Spécimen n°1 — en cours d’observation ». Les images sont converties en WebP (600, 1200 et 1800px) au moment du build.


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
