// Lecture de l'écriture à la main (Studio) avec Claude, côté serveur uniquement.
// La clé ANTHROPIC_API_KEY reste dans les variables d'environnement Vercel.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { HttpError } from './github';

const MODEL = 'claude-opus-5-5';

const ZoneResult = z.object({
  /** Texte transcrit, retours à la ligne compris. Vide s'il n'y a rien à lire. */
  text: z.string(),
  /** L'écriture est-elle entièrement en capitales ? */
  uppercase: z.boolean(),
});

const PageResult = z.object({
  items: z.array(
    z.object({
      text: z.string(),
      uppercase: z.boolean(),
      /** Cadre du texte, en millièmes de la largeur / hauteur de l'image (0 à 1000). */
      x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number(),
    }),
  ),
});

const RULES = `Règles :
- Recopie exactement ce qui est écrit, en français, avec les accents, la ponctuation et les majuscules telles qu'elles sont tracées.
- Garde les retours à la ligne de l'auteur.
- Ne corrige pas l'orthographe, n'ajoute rien, ne traduis rien.
- Une signature, un dessin ou un gribouillis n'est pas du texte.`;

const ZONE_PROMPT = `Cette image est un extrait d'une planche de bande dessinée dessinée à la main. Transcris le texte manuscrit qu'elle contient (bulle, légende, panneau, onomatopée…).
${RULES}
- S'il n'y a aucun texte lisible, renvoie un texte vide.`;

const PAGE_PROMPT = `Cette image est une planche de bande dessinée dessinée à la main. Repère chaque texte manuscrit (bulles, légendes, panneaux, onomatopées, notes) et transcris-le.
${RULES}
- Un élément = un bloc de texte d'un seul tenant (une bulle, un panneau…).
- Pour chaque élément, donne le cadre qui entoure juste l'écriture, en millièmes de la largeur (x) et de la hauteur (y) de l'image : x0,y0 en haut à gauche, x1,y1 en bas à droite.
- S'il n'y a aucun texte, renvoie une liste vide.`;

type Media = 'image/jpeg' | 'image/png';

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(501, 'La lecture de l’écriture n’est pas encore activée : ajoute la clé ANTHROPIC_API_KEY dans les variables d’environnement Vercel.');
  }
  return new Anthropic(); // lit ANTHROPIC_API_KEY (et ANTHROPIC_BASE_URL si défini)
}

async function ask<T extends z.ZodType>(schema: T, prompt: string, base64: string, media: Media, effort: 'low' | 'medium') {
  const anthropic = client();
  try {
    const response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // si le modèle refuse, l'API relance la demande sur un modèle de repli
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'Le service de lecture a refusé cette image.');
    if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'Réponse de lecture incomplète.');
    if (!response.parsed_output) throw new HttpError(502, 'Réponse de lecture illisible.');
    return response.parsed_output as z.infer<T>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'Clé ANTHROPIC_API_KEY refusée : vérifie-la dans Vercel.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Trop de demandes de lecture d’un coup : réessaie dans un instant.');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, `Demande de lecture refusée : ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Service de lecture indisponible (${e.status ?? 'réseau'}).`);
    throw e;
  }
}

export async function readZone(base64: string, media: Media) {
  const r = await ask(ZoneResult, ZONE_PROMPT, base64, media, 'low');
  return { text: r.text.trim(), uppercase: r.uppercase };
}

export async function readPage(base64: string, media: Media) {
  const r = await ask(PageResult, PAGE_PROMPT, base64, media, 'medium');
  const clamp = (v: number) => Math.min(1000, Math.max(0, v));
  return {
    items: r.items
      .map((it) => ({
        text: it.text.trim(), uppercase: it.uppercase,
        x0: clamp(Math.min(it.x0, it.x1)), y0: clamp(Math.min(it.y0, it.y1)),
        x1: clamp(Math.max(it.x0, it.x1)), y1: clamp(Math.max(it.y0, it.y1)),
      }))
      .filter((it) => it.text && it.x1 - it.x0 > 2 && it.y1 - it.y0 > 2),
  };
}
