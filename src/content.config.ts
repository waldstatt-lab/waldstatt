import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/** One Markdown file per game: the game idea, what to expect and the controls. */
const games = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/games" }),
  schema: z.object({
    title: z.string(),
    /** One sentence for cards and the top of the game page. */
    tagline: z.string(),
    /** The game's GitHub Pages deployment. */
    playUrl: z.url(),
    /** The game's repository. */
    sourceUrl: z.url(),
    /** Position in game lists, lowest first. */
    order: z.number(),
  }),
});

export const collections = { games };
