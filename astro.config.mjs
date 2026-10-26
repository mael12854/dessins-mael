import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  // Adresse publique du site (sert au sitemap et aux liens canoniques).
  site: 'https://dessins-mael.vercel.app',
  trailingSlash: 'ignore',
  // Pages statiques ; seule l'API d'admin (/api/admin) tourne sur le serveur.
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && !page.includes('/admin') })],
  image: {
    // Largeurs générées pour les planches (srcset).
    breakpoints: [600, 1200, 1800],
  },
});
