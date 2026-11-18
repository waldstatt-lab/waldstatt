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
an isometric view drawn with PixiJS 8 (WebGL) that turns top-down for reading;
the toolbox and menus are HTML, and so is everything visitors read or use on
the map. Its folder `src/waldstatt/` holds:

| Path | Contents |
| --- | --- |
| `Game.astro` | The page: map host, toolbox, menus, the back button, the confirmation for «Neu beginnen», and inert `<template>`s with the Ortstafel, the Chronik and each game's rendered Markdown |
| `Forest.astro` | The still picture: the start of the generated forest as SVG, shown until the game is ready and instead of it |
| `Icon.astro`, `icons.ts` | Pixel icons as colour grids for the toolbox, the Waldmensch's portrait and the app icon |
| `png.ts` | A small PNG encoder for the app icons at build time |
| `tools/waters.mjs`, `tools/download.mjs` | Generate `game/waters.ts` from swisstopo and BAFU data; see below |
| `game/waters.ts` | Generated: the rivers, brooks and lakes around Einsiedeln, the Sihlsee basin, the dam's site and the water names, in tiles |
| `game/config.ts` | The balance table: costs, footprints, build times, speeds, stock limits |
| `game/world.ts` | The world: the forest from a fixed seed, the water grid rasterized from `waters.ts` at start-up, and each lake's connected water |
| `game/iso.ts` | The projections between tiles and the screen: the isometric view, the top-down plan, and the blend between them |
| `game/state.ts` | The save in `localStorage`: versioned JSON, validated on load, reset by key prefix |
| `game/sim.ts` | The rules: marking and felling, Waldleute and their tasks, bridges, ports and ships, building sites, sheep and the printing press, the flood, the Waldmensch's hints |
| `game/nav.ts` | Finding ways: the Waldleute's search over open ground and crossings by ship, straightening ways, and ships' routes over their lake |
| `game/texts.ts` | Reads the templates and splits each text into sections at its `<h2>` headings |
| `game/art.ts` | The painted art for the isometric view on canvases at twice the resolution: trees, Waldleute, buildings, the amphitheatre's stands, ground textures |
| `game/plan.ts` | The same buildings, trees and Waldleute seen from straight above, for the plan view |
| `game/render.ts` | PixiJS: the ground in tile units under the view's projection (textured tiles in chunks of 16 × 16, rivers, lakes, the top-down art, the stage, placing, sawing and cursor overlays), and trees, buildings and Waldleute upright on top, sorted back to front; the camera's flights and the turn between the views |
| `game/overlay.ts` | The HTML lying on the map under the same projection: texts and Spielhaus plates; upright pins for water names and status labels; and the measuring of texts that sets their footprint |
| `game/stage.ts` | The theatre's stage, painted into one canvas on the amphitheatre's floor: the preview, a status line and wooden signs for the programme, the keys and the real game |
| `game/input.ts` | Pointer, touch, wheel and keyboard input on the map |
| `game/ui.ts` | The HTML interface, reading on the map, and announcements |
| `game/preview.ts`, `previewMoto.ts`, `previewCar.ts` | The previews' rules, copied from the studio website and repainted as a stage set |
| `game/main.ts` | Start-up, saving and the service worker registration |

`src/pages/` holds the home page and three endpoints: the web
manifest, the service worker `sw.js` and the app icons `icon-<size>.png`.

**The world.** One tile is 50 m; tile (0, 0) is the Klosterplatz Einsiedeln,
the first clearing, and north is −y. The map is isometric: tiles are 2:1
diamonds, so north lies to the upper right. The forest is generated per tile
from a fixed seed, mostly firs with patches of broadleaf trees, so every visitor
starts in the same forest and only changes are saved. The waters are real: the
Alp, the Sihl, the Biber, the Minster, the Lorze, the Wägitaler Aa, the Muota,
the Steiner Aa, the Jona and a few brooks, and the natural lakes from the
Zürichsee and the Ägerisee to the Hüttnersee. Rivers are drawn wider than they
are, as layered blue strokes with sandy banks; lakes as their shores. The
Sihlsee is a reservoir, so it is only a basin: until the visitor's dam floods
it, the Sihl and its brooks run through the valley along the lake axes the data
records. Other reservoirs, such as the Wägitaler See, are left out; their rivers
run through. Beyond the data's area, about 42 × 38 km, the forest goes on
without water. Ground chunks are made as they come into view, a few per frame,
and destroyed far off screen; trees, buildings and Waldleute are sorted by depth.
How far one can zoom out is limited so that about 16,000 tiles are on screen at
most.

**The water data.** `node src/waldstatt/tools/waters.mjs`
downloads the river network (swisstopo VECTOR25 GWN07,
`ch.swisstopo.vec25-gewaessernetz_referenz`) and the lakes (BAFU,
`ch.bafu.vec25-seen`) from api3.geo.admin.ch, about 200 requests cached in
`node_modules/.cache/waldstatt-games-waters/`, and writes `game/waters.ts`:
named rivers and brooks joined into lines, lakes clipped to the area, all
simplified and in tiles, the Sihlsee basin, the dam's site where the Sihl leaves
the basin at its north end, and points for the names. The site itself never
contacts swisstopo. The game's menu credits swisstopo and BAFU.

**Play.** The axe marks single trees; the saw marks every tree in a dragged area
(two fingers or another mouse button pan meanwhile); with «Abreissen», a first
tap marks a building in red and a second tap on it tears it down, returning half
its wood. Waldleute walk only on open ground: felled forest, the natural gaps,
bridges and the finished dam, never through standing trees or water. They build
the nearest site they can reach (counted a few tiles nearer) and otherwise fell
the nearest marked tree beside open ground, so a sawn area is cleared from its
edge inward and a tree marked deep in the forest waits until a way leads to it.
Felled wood counts at once. Ways are found tile by tile with eight neighbours,
never cutting between two diagonal trees, and straightened where the straight
line stays clear (`nav.ts`). A search reaches 256 tiles from the Waldmensch; to
keep it cheap, at most two run per frame, and tiles from which a search found
nothing are not searched again until a tree is marked or felled, a task is
freed or a way changes.

Water needs building. A **Brücke** spans a river where the visitor points:
the shorter of the straight runs of water across, up to five tiles, from bank
to bank. Brooks count as rivers; their water tiles are at least half a tile
wide, so they form an unbroken line. Lakes take no bridge. A **Hafen** stands on
the shore of a lake: a natural lake, or the Sihlsee once it is dammed. A
**Schiff** is built on the lake beside a finished port. Once a lake has a ship,
Waldleute cross it between any two of its ports: the search counts the
crossing as a path, a Waldmensch waits at the quay, the nearest free ship of
the lake comes, takes everyone waiting for the same crossing, sails over the
lake's water to the other port and returns to its own. Ships under way are not
saved; after a reload they lie at their ports.
Buildings stand only on cleared ground: a footprint with trees shows red,
«Zuerst die Bäume fällen». Each finished hut adds a Waldmensch, up to 16. Sheep
pastures grow parchment and the printing press turns parchment into prints
while the page is open; nothing happens while it is closed or hidden. The build
menu lists every building with its costs; those that cannot be built yet stay
listed with the reason, and the menu updates in place, so it keeps its scroll
position. Content buildings are one of a kind (per game for a game's
buildings). Nothing on the map opens a panel or dialog: a tap on a building
either turns the view to its text (below) or shows a short status label over it
for a few seconds. Choosing the dam names the buildings that will drown in the
placing bar; only «Neu beginnen» in the menu asks for confirmation.

**Content on the map.** What visitors read lies on the ground as real HTML,
cloned from the templates, in a layer under the same projection as the ground,
at 32 text pixels per tile. Each text takes as much ground as it needs: the
Ortstafel (the name), the Chronik (the about texts), each game's Spielidee (its
Markdown without the controls) and Anleitung (the controls table) are as long
as their text, measured once in a hidden copy with the map's styles
(`textLength()`), so the longer the text, the more forest must go. Scrolls lie
between two rollers, the Ortstafel on a board, the Anleitung on a notice board.
Each Spielhaus has a plate in front with «Spielen» and «Quellcode».

The theatre is a wooden amphitheatre: tiered stands with railings rise all
round a stage in its middle. The stage is painted on the map, not HTML
(`stage.ts`): a canvas texture lying on the amphitheatre's floor, so the stands
in front of it hide its edge. It shows the preview of a game whose Spielhaus
stands, a status line, and wooden signs for the programme, for each key of the
game's controls and for the real game. The previews are the rule sets of
the studio website's previews, copied into the Waldstatt and redrawn as a painted stage; a
demonstration plays until somebody takes over, and again after eight idle
seconds. The stage runs only while it is on screen.

A tap on a text, a plate or the stage turns the view: the camera flies to it
while the isometric view blends into a top-down plan with north up
(`projection()` in `iso.ts`), so the text lies upright and fills the width at a
comfortable size. Meanwhile trees, buildings and Waldleute blend from their
isometric pictures into ones seen from straight above (`plan.ts`). In the plan
the map can be dragged and zoomed in; zooming out, the button «Zurück zur
Karte» or Escape turns the view back. On the stage, taps on its signs press
them (held while the pointer stays down), the keys from the controls table
play, and the long sign opens the real game. The monastery is pure prestige,
drawn without religious symbols. The dam can only stand where the Sihl leaves
the basin; choosing it shows the future Sihlsee. When it is finished, the basin
floods for good: trees in it disappear, and drowned buildings stay as ruins
under the water.

**State and offline.** The save is one versioned JSON document under
`waldstatt-games/save`: supplies, felled trees as a bitset per chunk, marks,
buildings, the flood, the camera and the dismissed hint. A scroll's length
follows its current text on load, so changed texts need no migration. The game
saves two seconds after a change and when the page is hidden. The
organization's Pages sites share one origin and its `localStorage` (the games
save under `moto-devil/` and `car-drive/`), so the save is validated on load, a
broken save starts a new forest with a notice, and «Neu beginnen» removes only
keys starting with `waldstatt-games/`. The manifest's start URL and scope and
the service worker's scope are the base path. The
worker's cache is named after the build; it fetches the page network-first and
serves files under the base path and Astro's `_astro/` assets cache-first,
ignoring `Vary` because those URLs carry content hashes. On the first visit the
page hands the worker the files it already loaded, so the next start works
offline. The worker is not registered in development.

**Access.** The map is a focusable `role="application"`: arrow keys move a
cursor tile, Shift and arrows pan, + and − zoom, Enter or Space applies the tool
or opens a building, Escape cancels. While the view is turned onto the stage,
the keys from the game's controls play it instead. Every tool, menu item and
link is a real button or link with a German name; status, finished buildings,
the stage's status while somebody plays and the Waldmensch's hints are
announced politely,
and the texts on the map are in the page as a region «Im Wald». With reduced
motion Waldleute do not walk or swing their tools, ships do not sail visibly,
and the previews play no demonstration. Screen-reader users and search engines can hardly reach the
content: accepted in ADR 0002. The page weighs about
10 kB of HTML and about 210 kB of scripts, styles and water data, gzipped, most
of it PixiJS.

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
