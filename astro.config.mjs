import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Adresse publique du site (sert au sitemap et aux liens canoniques).
  site: 'https://specimens-mael.vercel.app',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  image: {
    // Largeurs générées pour les planches (srcset).
    breakpoints: [600, 1200, 1800],
  },
});
