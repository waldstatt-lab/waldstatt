# Architecture

A static website built with Astro 7, Tailwind CSS 4 and daisyUI 5
([ADR 0001](decisions/0001-build-a-static-site-with-astro-and-daisyui.md)) and
published on GitHub Pages. It has no server. Its home page is a building game
drawn with PixiJS, and its content is reached only through play
([ADR 0002](decisions/0002-make-the-waldstatt-a-browser-game.md)).
All text on the site is German, written with Swiss spelling ("ss", not "ß").
See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks.

## Waldstatt Games

A building game in an endless forest, shaped in the
[pitch](../pitches/pitch--aufbauspiel-im-wald.md): «Waldstatt» is
the historical name for Einsiedeln, and its people were the «Waldleute». The home
page is the whole site. Visitors fell trees, build, and earn the site's
content building by building; there are no about or game pages, and without
JavaScript or WebGL only a still picture of the forest, the name and a note show
([ADR 0002](decisions/0002-make-the-waldstatt-a-browser-game.md)). The map is
drawn with PixiJS 8 (WebGL); the toolbox, menus, building info and dialogs are
HTML. Its folder `src/waldstatt/` holds:

| Path | Contents |
| --- | --- |
| `Game.astro` | The page: map host, toolbox, menus, dialogs, the theatre's preview sections, and inert `<template>`s with the Ortstafel, the Chronik and each game's rendered Markdown |
| `Forest.astro` | The still picture: the start of the generated forest as SVG, shown until the game is ready and instead of it |
| `Icon.astro`, `icons.ts` | Pixel icons as colour grids: supplies, tools, the Waldmensch's portrait and the app icon |
| `png.ts` | A small PNG encoder for the app icons at build time |
| `game/config.ts` | The balance table: costs, footprints, build times, speeds, stock limits |
| `game/world.ts` | The generated world from a fixed seed: trees, the Alp and the Sihl, the dam site and the Sihlsee basin |
| `game/state.ts` | The save in `localStorage`: versioned JSON, validated on load, reset by key prefix |
| `game/sim.ts` | The rules: marking and felling, Waldleute and their tasks, building sites, sheep and the printing press, the flood, the Waldmensch's hints |
| `game/texts.ts` | Reads the templates and splits each text into sections at its `<h2>` headings |
| `game/art.ts` | The pixel art, drawn with canvas rectangles: trees, Waldleute, buildings, scrolls, ground |
| `game/render.ts` | PixiJS: chunks of 32 × 32 tiles, buildings and scrolls, marks, Waldleute, and the placing, sawing, cursor and flood overlays |
| `game/input.ts` | Pointer, touch, wheel and keyboard input on the map |
| `game/ui.ts` | The HTML interface and its announcements |
| `game/preview.ts`, `previewMoto.ts`, `previewCar.ts` | The theatre's previews, copied from the studio website and repainted as a stage set |
| `game/main.ts` | Start-up, saving and the service worker registration |

`src/pages/` holds the home page and three endpoints: the web
manifest, the service worker `sw.js` and the app icons `icon-<size>.png`.

**The world.** North is up. The forest is generated per tile from a fixed seed,
so every visitor starts in the same forest and only changes are saved. The Alp
and the Sihl are curves that flow together north of the first clearing;
downstream only the Sihl goes on. Upstream on the Sihl, south-east of the start,
lie the narrow spot for the dam and the basin of the Sihlsee. Chunks are
generated as they come into view, a few per frame, and destroyed when far off
screen. Trees are sprites from one generated atlas; the ground is a small canvas
per chunk, repainted where a tree falls. Buildings stay inside their footprint
and lie under the trees, so trees south of a building overlap it like trees in
front. How far one can zoom out is limited so that about 24,000 tiles are on
screen at most.

**Play.** The axe marks single trees; the saw marks every tree in a dragged area
(two fingers or another mouse button pan meanwhile). Waldleute walk in straight
lines, wade through rivers, fell the nearest marked tree (trees for building
sites first), and build sites whose footprint is free. Felled wood counts at
once. Each finished hut adds a Waldmensch, up to 16. Sheep pastures grow
parchment and the printing press turns parchment into prints while the page is
open; nothing happens while it is closed or hidden. Buildings show their costs
in the build menu, and those that cannot be built yet stay listed with the
reason. Content buildings are one of a kind (per game for a game's buildings);
tearing a building down returns half its wood.

**Content.** The Ortstafel explains the name. The Chronik (the about texts) and
each game's Spielidee (its Markdown without the controls) are scrolls: one strip
per `##` section, as long as its text. Laying a scroll needs only its head
cleared; the rest of its footprint is marked and unrolls into the forest as the
trees fall, and a section becomes readable once its strip is free. On the map a
strip shows its heading and ruled lines; the reading view shows the uncovered
sections as HTML cloned from the templates. Each game's Anleitung is a printed
notice with the controls table. Each game's Spielhaus offers its play and source
links. The theatre, once a Spielhaus stands, shows the previews of the games
whose Spielhaus stands: the rule sets of the studio website's previews, copied into
the Waldstatt and redrawn as a painted stage. The monastery is pure prestige,
drawn without religious symbols. The dam can only stand at the narrow spot of
the Sihl; choosing it shows the future lake, and a confirmation names the
buildings that will drown. When it is finished, the basin floods for good:
trees in it disappear, and drowned buildings stay as ruins under the water,
their content locked again.

**State and offline.** The save is one versioned JSON document under
`waldstatt-games/save`: supplies, felled trees as a bitset per chunk, marks,
buildings, the flood, the camera and the dismissed hint. Which sections are
uncovered is derived from the cleared tiles, and a scroll's length from its
current text, so changed texts need no migration. The game saves two seconds
after a change and when the page is hidden. The organization's Pages sites share
one origin and its `localStorage` (the games save under `moto-devil/` and
`car-drive/`), so the save is validated on load, a broken save starts a new
forest with a notice, and «Neu beginnen» removes only keys starting with
`waldstatt-games/`. The manifest's start URL and scope and the service worker's
scope are the base path. The worker's cache is named
after the build; it fetches the page network-first and serves files under the
base path and Astro's `_astro/` assets cache-first, ignoring `Vary`
because those URLs carry content hashes. On the first visit the page hands the
worker the files it already loaded, so the next start works offline. The worker
is not registered in development.

**Access.** The map is a focusable `role="application"`: arrow keys move a
cursor tile, Shift and arrows pan, + and − zoom, Enter or Space applies the tool
or opens a building, Escape cancels. Every tool, menu item and dialog is a real
button or link with a German name; status, finished buildings, uncovered
sections and the Waldmensch's hints are announced politely. With reduced motion
Waldleute do not walk or swing their tools, and the previews play no
demonstration. Screen-reader users and search engines can hardly reach the
content: accepted in ADR 0002. The page weighs about
10 kB of HTML and 195 kB of scripts and styles, gzipped, most of it PixiJS.

## Routes

| Route | Page | Source |
| --- | --- | --- |
| `/` | The game | [src/pages/index.astro](../../src/pages/index.astro) |

Beside the page lie `manifest.webmanifest`, `sw.js` and `icon-<size>.png`
([ADR 0002](decisions/0002-make-the-waldstatt-a-browser-game.md)). All routes lie
under the base path, `/waldstatt/` on GitHub Pages.

## Shared modules

| Path | Responsibility |
| --- | --- |
| [src/content.config.ts](../../src/content.config.ts) | The `games` collection schema: title, tagline, `playUrl`, `sourceUrl`, order |
| [src/content/games/](../../src/content/games/) | One Markdown file per game, rendered into the texts hidden in the forest |
| [src/lib/games.ts](../../src/lib/games.ts) | `getGames()`: all games in display order |
| [src/lib/url.ts](../../src/lib/url.ts) | `href()`: prefixes internal paths with the base path |
| [astro.config.mjs](../../astro.config.mjs) | Site URL and base path from `SITE_URL` / `BASE_PATH`, trailing slashes, Tailwind |

## Conventions

- Link internal paths with `href("/path/")`, never a bare `/path/`, so the site
  works under a base path. URLs end with a slash (`trailingSlash: "always"`).
- Game links point to the games' deployments (`playUrl`); this site never copies
  game builds. When the organization is renamed, update every `playUrl` and
  `sourceUrl`.

## Deployment

[pages.yml](../../.github/workflows/pages.yml) builds and deploys `dist/` on every
push to `main`; [ci.yml](../../.github/workflows/ci.yml) runs `mise run check` on
pull requests. The repository name decides the address: a repository named
`<owner>.github.io` is served at `https://<owner>.github.io/`; any other name, like
this one, at `https://<owner>.github.io/<repository>/`. On the free organization
plan the repository must be public, and Pages must use "GitHub Actions" as its
source.
