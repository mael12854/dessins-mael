import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Un dossier par spécimen : specimens/<numéro>-<nom>/index.md (+ images à côté).
const specimens = defineCollection({
  loader: glob({ pattern: '*/index.md', base: './specimens' }),
  schema: ({ image }) =>
    z
      .object({
        n: z.number().int().positive(),
        series: z.enum(['metro', 'hs']),
        tech: z.enum(['feutre', 'numerique', 'mixte']).default('feutre'),
        title: z.string(),
        latin: z.string().optional(),
        date: z.string().regex(/^(\d{2}\.\d{2}\.\d{4}|—)$/, 'Format attendu : JJ.MM.AAAA'),
        lieu: z.string(),
        image: image().optional(),
        alt: z.string().optional(),
        signature: image().optional(),
        pending: z.boolean().default(false),
        fiche: z
          .object({
            image: image().optional(),
            alt: z.string().optional(),
            habitat: z.string(),
            cri: z.string(),
            rush: z.string(),
            crush: z.string(),
            annotations: z
              .array(z.object({ text: z.string(), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }))
              .max(4)
              .default([]),
          })
          .optional(),
      })
      .refine((s) => !s.image || !!s.alt, { message: 'Texte alternatif (alt) obligatoire quand il y a une image.' })
      .refine((s) => !s.fiche?.image || !!s.fiche?.alt, { message: 'fiche.alt obligatoire quand la fiche a un dessin.' }),
});

export const collections = { specimens };
