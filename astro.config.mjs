import { defineConfig } from 'astro/config';

export default defineConfig({
  // Pas de sitemap, pas d'analytics : le site est privé.
  trailingSlash: 'ignore',
  image: {
    // Largeurs générées pour les planches (srcset).
    breakpoints: [600, 1200, 1800],
  },
});
