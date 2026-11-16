# Architecture

A static website built with Astro 7, Tailwind CSS 4 and daisyUI 5
([ADR 0001](decisions/0001-build-a-static-site-with-astro-and-daisyui.md)) and
published on GitHub Pages. It has no server, and no content depends on client-side
JavaScript. All text on the site is German, written with Swiss spelling ("ss",
not "ß"). See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks.

## Structure

| Path | Contents |
| --- | --- |
| `src/pages/` | The pages: `index.astro`, `ueber-uns.astro` and `spiele/[game].astro` |
| `src/waldstatt/meta.ts` | The site's name and tagline |
| `src/waldstatt/Layout.astro` | HTML shell with `data-theme="waldstatt-games"` and the navigation; loads `styles.css` |
| `src/waldstatt/GameCard.astro` | A game card linking to the game and to its page |
| `src/waldstatt/styles.css` | Tailwind, typography plugin, and daisyUI without built-in themes |
| `src/waldstatt/theme.css` | The site's custom daisyUI theme, started as a copy of daisyUI's forest |

## Routes

| Route | Page | Source |
| --- | --- | --- |
| `/` | Home: name, tagline, game cards | [src/pages/index.astro](../../src/pages/index.astro) |
| `/ueber-uns/` | About the studio | `src/pages/ueber-uns.astro` |
| `/spiele/<game>/` | Game idea, what to expect, controls, play link | `src/pages/spiele/[game].astro` |

All routes lie under the base path, `/waldstatt/` on GitHub Pages.

## Shared modules

| Path | Responsibility |
| --- | --- |
| [src/content.config.ts](../../src/content.config.ts) | The `games` collection schema: title, tagline, `playUrl`, `sourceUrl`, order |
| [src/content/games/](../../src/content/games/) | One Markdown file per game; the file name is the route segment |
| [src/lib/games.ts](../../src/lib/games.ts) | `getGames()`: all games in display order |
| [src/lib/url.ts](../../src/lib/url.ts) | `href()`: prefixes internal paths with the base path |
| [astro.config.mjs](../../astro.config.mjs) | Site URL and base path from `SITE_URL` / `BASE_PATH`, trailing slashes, Tailwind |

## Conventions

- Link internal pages with `href("/path/")`, never a bare `/path/`, so the site
  works under a base path. URLs end with a slash (`trailingSlash: "always"`).
- Game links point to the games' deployments (`playUrl`); this site never copies
  game builds. When the organization is renamed, update every `playUrl` and
  `sourceUrl`.
- Style with daisyUI components and Tailwind utilities and the theme colors
  (`bg-base-100`, `btn-primary`, and so on), so a theme change restyles the whole
  site.

## Deployment

[pages.yml](../../.github/workflows/pages.yml) builds and deploys `dist/` on every
push to `main`; [ci.yml](../../.github/workflows/ci.yml) runs `mise run check` on
pull requests. The repository name decides the address: a repository named
`<owner>.github.io` is served at `https://<owner>.github.io/`; any other name, like
this one, at `https://<owner>.github.io/<repository>/`. On the free organization
plan the repository must be public, and Pages must use "GitHub Actions" as its
source.
