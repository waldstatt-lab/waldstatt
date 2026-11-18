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
page is the whole site. Visitors fell trees, build, and find the site's
content hidden in the forest; there are no about or game pages, and without
JavaScript or WebGL only a still picture of the forest, the name and a note show
([ADR 0002](decisions/0002-make-the-waldstatt-a-browser-game.md)). The map is
an isometric view drawn with PixiJS 8 (WebGL) that turns top-down for reading;
the toolbox and menus are HTML, and so is everything visitors read or use on
the map. Its folder `src/waldstatt/` holds:

| Path | Contents |
| --- | --- |
| `Game.astro` | The page: map host, toolbox, menus, the back button, the confirmation for «Neu beginnen», and inert `<template>`s with the Ortstafel, the Chronik and each game's rendered Markdown, which lie hidden in the forest |
| `Forest.astro` | The still picture: the start of the generated forest as SVG, shown until the game is ready and instead of it |
| `Icon.astro`, `icons.ts` | Pixel icons as colour grids for the toolbox, the Waldmensch's portrait and the app icon |
| `png.ts` | A small PNG encoder for the app icons at build time |
| `tools/waters.mjs`, `tools/gpkg.mjs`, `tools/shapefile.mjs`, `tools/download.mjs` | Generate the water data from swisstopo's GeoPackages and BAFU's stream orders; see below |
| `game/waters.ts` | Generated: the index of the water pages (which have a file, which lie wholly in Switzerland), the Sihlsee basin, the dam's site and the page format |
| `data/water-pages.json` | Generated: Switzerland's waters and border in pages of 10 × 10 km, in tiles; one long line, ignored by Prettier |
| `game/config.ts` | The balance table: costs, footprints, build times, speeds, stock limits, the hidden texts and where they lie |
| `game/world.ts` | The world: the forest from a fixed seed, and the water pages, loaded as they come into view and rasterized into tiles: water, lakes by number, the palisade and the land abroad |
| `game/iso.ts` | The projections between tiles and the screen: the isometric view, the top-down plan, and the blend between them |
| `game/state.ts` | The save in `localStorage`: versioned JSON, validated on load, reset by key prefix |
| `game/sim.ts` | The rules: the tools on the ground, marking and felling, the hidden texts, Waldleute and their tasks, bridges, ports and ships, building sites, sheep, the crews of quarries and the printing house, the ravens, the flood, the Waldmensch's hints |
| `game/nav.ts` | Finding ways: the Waldleute's search over open ground and crossings by ship, straightening ways, and ships' routes over their lake |
| `game/texts.ts` | Reads the templates and splits each text into sections at its `<h2>` headings |
| `game/art.ts` | The painted art for the isometric view on canvases at twice the resolution: trees, Waldleute, ravens, the axe and the saw, buildings (a house of its own for each game, with the game's name painted on its front), the amphitheatre in two parts, ground textures |
| `game/plan.ts` | The same buildings, trees and Waldleute seen from straight above, for the plan view |
| `game/render.ts` | PixiJS: the ground in tile units under the view's projection (textured tiles in chunks of 16 × 16 with gaps where found texts lie, rivers, lakes, the top-down art, the stage, placing, sawing and cursor overlays), and trees, buildings, Waldleute and the tools on the ground upright on top, sorted back to front, with the ravens and the motes over hidden texts above; the camera's flights and the turn between the views |
| `game/overlay.ts` | The HTML lying on the map under the same projection: found texts under the canvas; upright pins for water names, Einsiedeln and status labels; and the measuring of texts that sets their footprint |
| `game/stage.ts` | The theatre's stage in two canvases: the preview standing on the stage in 3D for the isometric view, and, turned top-down, the preview in 2D with a status line and wooden signs for the programme, the keys and the real game, on the amphitheatre's floor |
| `game/input.ts` | Pointer, touch, wheel and keyboard input on the map |
| `game/ui.ts` | The HTML interface, reading on the map, and announcements |
| `game/preview.ts`, `previewMoto.ts`, `previewCar.ts` | The previews' rules, copied from the studio website and repainted as a stage set, each with its scene in 2D and in 3D |
| `game/main.ts` | Start-up, saving and the service worker registration |

`src/pages/` holds the home page and four endpoints: the web
manifest, the service worker `sw.js`, the app icons `icon-<size>.png`, and the
water pages `waters/<px>_<py>.json`.

**The world.** One tile is 50 m; tile (0, 0) is the Klosterplatz Einsiedeln,
and north is −y. The first clearing lies 1.8 km north of it at Holzrüti 2
(ISE AG, LV95 2699524 / 1222155 from the federal building register), on the
Alp's west bank. The map is isometric: tiles are 2:1
diamonds, so north lies to the upper right. The forest is generated per tile
from a fixed seed, mostly firs with patches of broadleaf trees, so every visitor
starts in the same forest and only changes are saved. The map covers all of
Switzerland, and its waters are real, from swissTLM3D: rivers and brooks from
Strahler stream order 5 on, after BAFU, and the natural lakes from 0.03 km².
Rivers from order 6 on are drawn wide, the others as brooks, as layered blue
strokes with sandy banks; lakes as their shores. The Sihlsee is a reservoir, so
it is only a basin: until the visitor's dam floods it, the Sihl and its brooks
run through the valley along the lake axes the data records. Other reservoirs,
found by the dams at their shores, are left out; their rivers run through. The
national border is a wooden palisade, with gaps only where water crosses it;
beyond it lies the land abroad, bare and dim, where nobody walks or builds.

The waters come in pages of 10 × 10 km (200 × 200 tiles), one file each, about
1 kB gzipped and at most 3 kB. The pages round Einsiedeln and round the saved
view load before the game starts, as the hidden texts are placed by them;
others load, four at a time, when a chunk of ground in them comes into view.
A page is rasterized into tiles once it arrives: water, the lake each tile
belongs to (so ships know their lake), the palisade, and abroad. Pages wholly
abroad, or wholly in Switzerland without water, have no file. Until its page is
there, a tile counts as forest, its ground is not drawn, and it cannot be
marked; when it arrives, the chunks it touches are made anew and the Waldleute
look for ways again. Ground chunks are made as they come into view, a few per
frame, and destroyed far off screen; trees, buildings and Waldleute are sorted
by depth.
How far one can zoom out is limited so that about 16,000 tiles are on screen at
most.

**The water data.** `node src/waldstatt/tools/waters.mjs`
downloads swisstopo's swissTLM3D (about 5 GB zipped, 11 GB unzipped) and
swissBOUNDARIES3D as GeoPackages from data.geo.admin.ch, and BAFU's
«Flussordnungszahl nach Strahler» (FLOZ, a shapefile, open use), once, into
`node_modules/.cache/waldstatt-games-waters/`; unzipping needs `unzip`. It
reads them with Node's built-in `node:sqlite` and a small shapefile reader and
writes `game/waters.ts` and `data/water-pages.json` in about 15 seconds.
swissTLM3D records no stream order, and computing one over its braided
channels, canals and lake axes inflates it; BAFU computed FLOZ on the older
VECTOR25 network. So each piece of swissTLM3D takes the order of the nearest
FLOZ segment of the same watercourse, matched by its water body number
(`gewiss_nr`, `GEWISSNR`) at the piece's midpoint; a watercourse FLOZ does not
know takes the order of a river within 60 m. Kept pieces, culverts included,
are joined into lines per watercourse and width, whichever way each was
drawn. Lake areas are the land cover's
standing waters, named after the shore lines that cover the same box; a lake
with a Staudamm or Staumauer within 100 m of its shore is a reservoir. The
border is Switzerland's area without Liechtenstein, with Büsingen and Campione
as holes. Everything is simplified (rivers to 12.5 m, lakes to 17.5 m, the
border to 25 m), rounded to a tenth of a tile and cut into pages; lines reach
two tiles past their page so strokes meet at its edges. The endpoint
`waters/[page].json.ts` serves each page as its own file. The site itself never
contacts swisstopo or BAFU. The game's menu credits both.

**Play.** The tools lie on the ground and are picked up with a tap: the axe
in the first clearing, beside the Waldmensch; the saw, once a hut stands and
100 trees are felled, where the last of them fell. Until then their buttons
are missing from the toolbox. The axe marks single trees; the saw marks every tree in a dragged area
(two fingers or another mouse button pan meanwhile); with «Abreissen», a first
tap marks a building in red and a second tap on it tears it down, returning half
its costs. Waldleute walk only on open ground: felled forest, the natural gaps,
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

A **Steinbruch** gives stones, the **Druckerei** books. Tapping a finished
quarry or printing house shows a bar with − and + to put Waldleute in, up to
four; the idle and the nearest go first, walk there and work: in a quarry they
break stones at its rock face, one every five seconds each, up to a stock of
300; in the printing house they print books at its door, one every eight
seconds each, from one parchment and two wood, up to a stock of 20. They do no
other work until they are taken out again. Once a
quarry stands, the tool **Pflastern** plans cobbles like the saw marks trees:
tap a tile, or drag over an area, of cleared, dry ground that is not built on,
texts included. Waldleute lay one stone per planned tile, as long as there
are stones, and walk half again as fast on cobbles. Planned tiles show a pale
frame until they are paved.
Buildings stand only on cleared ground: a footprint with trees shows red,
«Zuerst die Bäume fällen». Each finished hut adds a Waldmensch, up to 16. Sheep
pastures grow parchment, quarries and the printing house work while the page
is open; nothing happens while it is closed or hidden. The first buildings
take wood, and parchment for the Spielhaus; the larger ones also stones and
books: the printing house, the libraries, the theatre, the Kloster, whose
library takes the most books, the dam and the ports (`config.ts`). The build
menu lists every building with its costs; those that cannot be built yet stay
listed with the reason, and the menu updates in place, so it keeps its scroll
position. Content buildings are one of a kind (per game for a game's
buildings). Nothing on the map opens a panel or dialog: a tap on a building
either turns the view to its text (below) or shows a short status label over it
for a few seconds. Choosing the dam names the buildings that will drown in the
placing bar; only «Neu beginnen» in the menu asks for confirmation.

**Content on the map.** The texts are not built; they lie hidden under the
forest and are explored by felling it. The Ortstafel (the name) and the
Chronik (the about texts) lie within 1 km of the Klosterplatz, each game's
scroll (its whole Markdown, controls included) 1.5 to 5 km from it, on dry land
outside the Sihlsee's basin. Where exactly is chosen at random for each new
forest from a seed and saved. A hidden text lies under unbroken forest:
its tiles always carry a tree, its ground shimmers pale, and motes of light
drift over its treetops. Its first felled tree finds it; once all its trees are
felled it is explored, and a game's explored scroll lets its Spielhaus be
built. A text is wider on wide screens (9 to 13 tiles) than on narrow ones (6
to 8), chosen once when the page starts, and as long as its text, measured
once in a hidden copy with the map's styles (`textLength()`). The view reads it
at zoom 0.95 at most, so its 12 text pixels show at about 16 screen pixels. A found text is real HTML, cloned from the
templates, in a layer under the map's canvas and under the same projection as
the ground, at 32 text pixels per tile: the canvas is transparent where no
ground is drawn, and the ground leaves a gap on each cleared tile of a found
text. So the text lies on the floor, the trees still standing cover the rest,
and Waldleute and buildings stand over it. It is cream with golden headings
on a dark green floor; on cobbled tiles the floor under it shows cobbles, and
a dark copy of the text, hidden from screen readers, shows instead of the light
one, with a hairline stroke that thickens its letters without moving its
lines. Under a text, cobbles are faint: stones and mortar are almost the same
light colour, so their pattern does not compete with the letters; elsewhere
they are drawn light with narrow joints. Each ink is masked to its tiles
at four mask pixels per tile, so a cobbled path across a text changes its ink
tile by tile. When cobbles are laid, the new floor and masks are made as images
and decoded before they replace the old ones, all at once, so the text does not
flicker. Buildings cannot be placed on a text. A label marks Einsiedeln on the map.

Meinrads Klause and the Kloster each bring one of Meinrad's two ravens. A
raven leads to a game's scroll that is not yet explored, the nearest first
and one per raven: it circles about 500 m into the forest from the felled
ground nearest the scroll, and over the scroll once it is found; with no
scroll left it circles its own building. Its direction is announced.

Each game has a house of its own: Moto Devil a keep with a tower and a jump
ramp, Car Drive a coach house with two gates and a lantern turret; another game
gets a generic house. The game's name is painted on a board on the house's
front, in the plane of its wall. A tap on the house opens the game in a new
tab. Once its Spielhaus stands, each game can have a **Bibliothek**: a stone
hall with the game's name and «Quellcode» over its door and books stacked
outside; it costs books, and a tap on it opens the game's source code in a new
tab. Both are announced, so keyboard users reach them with the cursor and
Enter.

The theatre is a wooden amphitheatre: tiered stands with railings rise all
round a stage in its middle, with a backdrop and red curtains at its back,
pennants and torches. A painted audience sits on the stands, the same seats in
both views (`crowd()` in `art.ts`); the first front row stays free, so the
hint lying before the stage stays readable. The stage is painted on the map, not HTML (`stage.ts`).
In the isometric view the preview of a game whose Spielhaus stands plays in 3D
on the stage: its picture stands between the theatre's back and front, which
are painted apart, so the front stands hide it. Turned top-down, a canvas
texture lying on the amphitheatre's floor shows the preview in 2D, a status
line, and wooden signs for the programme, for each key of the game's controls
and for the real game. The previews are the rule sets of
the studio website's previews, copied into the Waldstatt and redrawn as a painted stage; a
demonstration plays until somebody takes over, and again after eight idle
seconds. The stage runs only while it is on screen.

A tap on a found text or the stage turns the view: the camera flies to it
while the isometric view blends into a top-down plan with north up
(`projection()` in `iso.ts`), so the text lies upright and fills the width at a
comfortable size. Meanwhile trees, buildings and Waldleute blend from their
isometric pictures into ones seen from straight above (`plan.ts`). In the plan
the map can be dragged and zoomed in and out; zoomed out below half the
reading zoom, it turns back to the isometric view where and as high as it is,
and the button «Zurück zur Karte» or Escape turns it back to where it was. On the stage, taps on its signs press
them (held while the pointer stays down), the keys from the controls table
play, and the long sign opens the real game in a new tab. The monastery and
Meinrads Klause are drawn without religious symbols. The dam can only stand where the Sihl leaves
the basin; choosing it shows the future Sihlsee. When it is finished, the basin
floods for good: trees in it disappear, and drowned buildings stay as ruins
under the water.

**State and offline.** The save is one versioned JSON document under
`waldstatt-games/save`: supplies, felled trees as a bitset per chunk, marks,
buildings with the crew of a quarry or the printing house, the flood, the camera, the dismissed hint,
the tools picked up, where the saw lies, the seed and positions of the hidden
texts, stones, and cobbled and planned tiles (cobbles as a bitset per chunk).
Saves from before stones and cobbles load without them, and a save's prints,
from before the printing house made books, load as books. A save
from before the move to Holzrüti (version 1) starts a new forest with a
notice. A text's length follows its current text on load, so changed texts
need no migration. The game
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
10 kB of HTML, a 130 kB script (most of it PixiJS, which loads its WebGL parts
as further chunks) and 20 kB of styles, gzipped; the water follows in pages of
about 1 kB.

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
