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
| `Game.astro` | The page: map host, toolbox, menus, the back button, the confirmation dialog, the dialog «Wälder» for saved forests, and inert `<template>`s with the Ortstafel, the Chronik and each game's rendered Markdown, which lie hidden in the forest |
| `Forest.astro` | The still picture: the start of the generated forest as SVG, shown until the game is ready and instead of it |
| `Icon.astro`, `icons.ts` | Pixel icons as colour grids for the toolbox, the Waldmensch's portrait and the app icon |
| `png.ts` | A small PNG encoder for the app icons at build time |
| `tools/waters.mjs`, `tools/gpkg.mjs`, `tools/shapefile.mjs`, `tools/download.mjs` | Generate the water data from swisstopo's GeoPackages and BAFU's stream orders; see below |
| `game/waters.ts` | Generated: the index of the water pages (which have a file, which lie wholly in Switzerland), the Sihlsee basin, the dam's site and the page format |
| `data/water-pages.json` | Generated: Switzerland's waters and border in pages of 10 × 10 km, in tiles; one long line, ignored by Prettier |
| `game/config.ts` | The balance table: costs, footprints, build times, speeds, stock limits, the hidden texts and where they lie |
| `game/world.ts` | The world: the forest from a fixed seed, and the water pages, loaded as they come into view and rasterized into tiles: water, lakes by number, the palisade and the land abroad |
| `game/iso.ts` | The projections between tiles and the screen: the isometric view, the top-down plan, and the blend between them |
| `game/state.ts` | The save in IndexedDB ([ADR 0003](decisions/0003-save-the-waldstatt-in-indexeddb.md)): the settlement, the people and one record per chunk, validated on load, written in part, reset by deleting the database; snapshots of the whole forest, and replacing it with another in one transaction |
| `game/saves.ts` | Forests saved under a name in the database `waldstatt-games-saves`, and forests as JSON files to download and read back ([ADR 0004](decisions/0004-keep-named-waldstatt-saves-and-files.md)) |
| `game/savesDialog.ts` | The dialog «Wälder»: save under a name, the list to load, download or delete, the forest being played as a file, and a forest from a file |
| `game/sim.ts` | The rules: the tools on the ground, marking and felling, the hidden texts, Waldleute and their tasks (walking back to eat included), bridges, ports and ships, building sites, placing rules, what the build menu shows, ruins and repair, the ravens; it steps the systems below in turn |
| `game/economy.ts` | The goods: the shared stock and its limits, the crews and recipes of the producing buildings, beer for the Spielhäuser and the theatre, the upkeep of the Klause, the churches and the Kloster, the Brot auswerfen |
| `game/people.ts` | The Waldleute's lives: ages, meals and where food reaches, children, deaths, graves and tombstones, beds, the fire and the first pair |
| `game/mood.ts` | Motivation: where it tends with what stands, passing events, and the work speed it sets |
| `game/growth.ts` | The forest growing back: seedlings on felled ground beside forest, kept down where Waldleute walk |
| `game/flood.ts` | The Sihlsee filling and draining tile by tile, buildings sinking, and the flood wave down the Sihl |
| `game/nav.ts` | Finding ways: the Waldleute's search over open ground and crossings by ship, straightening ways, and ships' routes over their lake |
| `game/texts.ts` | Reads the templates and splits each text into sections at its `<h2>` headings |
| `game/art.ts` | The painted art for the isometric view on canvases at twice the resolution: trees, Waldleute, ravens, the axe and the saw, buildings (a house of its own for each game, with the game's name painted on its front), the amphitheatre in two parts, ground textures |
| `game/ise-logo.png` | The ISE AG's logo as the ISE AG provided it, scaled to 600 pixels wide; `main.ts` loads it before the art is painted, and `art.ts` puts it on the board in front of the ISE AG's forge |
| `game/plan.ts` | The same buildings, trees and Waldleute seen from straight above, for the plan view |
| `game/render.ts` | PixiJS: the ground in tile units under the view's projection (textured tiles in chunks of 16 × 16 with gaps where found texts lie, rivers, lakes, the top-down art, the stage, placing, sawing and cursor overlays), and trees, buildings, Waldleute and the tools on the ground upright on top, sorted back to front, with the ravens and the motes over hidden texts above; the camera's flights and the turn between the views |
| `game/overlay.ts` | The HTML lying on the map under the same projection: found texts under the canvas; upright pins for water names, Einsiedeln and status labels; and the measuring of texts that sets their footprint |
| `game/stage.ts` | The theatre's stage in two canvases: the preview standing on the stage in 3D for the isometric view, and, turned top-down, the preview in 2D with a status line and wooden signs for the programme, the keys and the real game, on the amphitheatre's floor |
| `game/input.ts` | Pointer, touch, wheel and keyboard input on the map, with counts before a movement |
| `game/keys.ts` | The keymap ([ADR 0005](decisions/0005-keep-the-waldstatt-keymap-in-a-settings-database.md)): each action's keys, the defaults, conflict checks, and keeping it in the database `waldstatt-games-settings` |
| `game/keysDialog.ts` | The dialog «Tasten»: each action's keys, removing one, adding the next key pressed, and the defaults |
| `game/textCursor.ts` | The text mode on a text read top-down, as vim's normal and visual modes: a block cursor moved by characters, lines, words, gg and G with counts, selections by character (v) or line (V), o, and copying, drawn as CSS highlights |
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
by depth. Buildings that lie mostly flat (Getreidehof, Viehhof, Schafweide,
Friedhof) are painted in two parts: their fields, pastures and fences on a flat
layer under everything upright, and their house, barn, shelter or yew sorted
by its own front corner, so trees beside them stand in front of the fields.
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

**Goods and crews.** Holz, Steine, Pergament, Bücher, Getreide, Mehl, Brot,
Fleisch and Bier are one shared stock with a limit each; nothing is carried,
and what a building makes is in stock at once (`economy.ts`). The producing
buildings take a crew of up to four: the Schafweide (parchment), Getreidehof
(grain), Viehhof (meat), Mühle (grain to flour, only on a river bank),
Bäckerei (flour to bread), Brauerei (grain to beer), Steinbruch (stones) and
Druckerei (parchment and wood to books). One Waldmensch at a Viehhof feeds
about three; one in the chain of Getreidehof, Mühle and Bäckerei about five.
A new one asks for a full crew;
tapping a finished one opens its card with − and + to change it. Crews are
filled every second from the idle and the nearest adults, so Waldleute who come
of age or become free join them, always leaving one free to fell and build;
they work only once there, each faster with motivation. With its stock full, a
building stops producing and its crew waits there. Once
there are stones, the tool **Pflastern** plans cobbles like the saw marks
trees: tap a tile, or drag over an area, of cleared, dry ground that is not
built on, texts included. Waldleute lay one stone per planned tile, as long as
there are stones, and walk half again as fast on cobbles. Planned tiles show a
pale frame until they are paved.

**The Waldleute live** (`people.ts`). Each is a person with a position, an
age, a sex, hunger and work; children (under 14) do not work, and a year
passes in 40 seconds of play. The game starts with a woman of 18 and a man of
20 by a fire in the first clearing, with 30 meat. Waldleute eat a meal every
45 seconds, children every 90:
within 1 km of a Viehhof or a Bäckerei, or of the fire until the first of
them stands, food reaches them where they are; farther out, a hungry
Waldmensch leaves their work and walks back. Four minutes hungry, or old enough
(60 to 80 years), they die. A woman and a man of the right age have children
now and then while food is plenty, sooner with beer in stock, born by the
nearest house. Motivation sets how often: below 50 % with its square (a quarter
as many at 25 %, none at 0 %), above it up to one and a half times at 100 %. Huts give four beds, the Steinhaus twelve, the fire two; more
Waldleute than beds lowers motivation and makes the years pass faster. Who dies
within 1 km of a church or the Kloster whose graveyard has room is buried
there; elsewhere a tombstone stays, and motivation drops for a while. A
settlement can die out; nothing brings new Waldleute but children, and no
more are born beyond 1,000, where the rules take about 1.3 ms a frame. Children are
drawn smaller, the old greyer and the hungry paler.

**Motivation** («Stimmung», `mood.ts`) sets how fast everybody fells, builds,
paves and produces, from half to one and a half times. It drifts towards a
level raised by working churches and the Kloster, the ISE AG and Spielhäuser
with beer, and lowered by Spielhäuser without beer, overcrowding and hunger;
opening a game from a Spielhaus, the Brot auswerfen and lonely deaths move it
for a while. The Klause, the churches and the Kloster use food and books every
minute, but only goods the settlement can already make; without them they
decay, lose their effect below half (the raven leaves), and fall into ruins,
which a tap repairs for half the costs. A Spielhaus and the theatre drink beer;
without it they are shut, and their play link and stage do not open. The
Brot auswerfen waits for 100 loaves, then throws them one by one to the
hungriest nearby and takes itself down. While it throws, a crowd as large as
the settlement (5 to 16) stands cheering in front of the stage, two Waldleute
on it throw, and each loaf flies in an arc to somebody who jumps to catch it;
the crowd is drawn only, it takes nobody from work (`render.ts`).

**The forest grows back** (`growth.ts`): felled ground beside forest grows
seedlings, drawn small and light, which become trees after four minutes. They
never grow on cobbles, water, buildings, tombstones, by the fire, or where a
Waldmensch walked in the last two minutes, so ways stay open. Over a text they
cover it again unless it is cobbled; a game whose scroll once lay free stays
explored.

**Building.** Buildings stand only on cleared ground: a footprint with trees
shows red, «Zuerst die Bäume fällen». A building chosen in the menu appears in
the middle of the view, drawn above the trees and reddish where it cannot
stand, with a small card on it: its name and costs, and why it cannot stand
there. There is no bar or dialog. How it is placed follows how it was chosen. With
the mouse it follows the pointer and a click builds; with the keyboard (from
the menu or the «:» finder) it starts at the keyboard cursor, follows it, and
Enter builds; both show only a slim label and stop with Escape (or a right
click). By touch, a drag that starts on it or a tap elsewhere moves it (other
drags still pan), and its card carries «Bauen» and ×. Some have rules of their own: a church
stands more than 1 km from every other church and Kloster not under water, a
graveyard right beside a church or the Kloster, the ISE AG in the first
clearing, the Mühle on a river bank. The build menu shows each building as a
small picture, painted by the same code as the map, and its name; costs show
only while placing. It shows only what has appeared, and what appeared stays:
the Mühle with a Getreidehof, the Bäckerei with a Getreidehof and 10 Waldleute,
the Brauerei with a Getreidehof and 20, a game's Spielhaus once its scroll lay
free and a Brauerei stands, its Bibliothek with its Spielhaus, the theatre with
a Brauerei and a Spielhaus, churches with a Druckerei and 20 Waldleute, the
graveyard with a church or the Kloster, the Kloster with a Druckerei and 50,
the ISE AG with a Druckerei, the Brot auswerfen with a Bäckerei, the dam once
every tree on its site is felled, and the Steinhaus at 100 Waldleute. A dot on
«Bauen» marks that something appeared, until the menu is opened. Content
buildings are one of a kind (per game for a game's buildings). Nothing on the
map opens a panel or dialog: a tap on a building turns the view to its text or
stage, or opens its game or source; otherwise it opens a small card on the map
above the building with its state and stock, − and + for a crew, or the repair
of a ruin. A tap anywhere else, the card's ×, or Escape closes it. Other
messages show as a short label over a building for a few seconds. Nothing explains the game: there are no hints,
and announcements tell only what happened. Only «Neu beginnen» and loading,
overwriting or deleting a saved forest ask for confirmation.

**Resources.** On wide screens a bar along the top shows the goods the
settlement has had, the Waldleute and beds, motivation, and, from the first
death on, how many Waldleute died (its tooltip splits them into age and
hunger); on phones the same list is in the menu, with the split written out,
and only the toolbox stays at the bottom. The deaths are counted in the save.

**Content on the map.** The texts are not built; they lie hidden under the
forest and are explored by felling it. The Ortstafel (the name) and the
Chronik (the about texts) lie within 1 km of the Klosterplatz, each game's
scroll (its whole Markdown, controls included) 6 to 12 km from the first
clearing, on dry land
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
Meinrads Klause, the churches and the graveyards are drawn without religious
symbols; graves are tombstones. The dam can only stand where the Sihl leaves
the basin; choosing it shows nothing of the lake to come. While it stands, the
water spreads from the Sihl through the basin in a fixed order, tile by tile,
until the Sihlsee is full after 15 minutes (`flood.ts`): trees in it die,
buildings it reaches sink over a minute and a half, and Waldleute step back
from it. In the full lake only the towers of drowned churches and of the
Kloster rise above the water; drowned buildings no longer count, so a new
church or Kloster may be built. Tearing the dam down sends a wave down the Sihl
towards the Zürichsee: its band, two and a half tiles each side of the river
from the dam on, is found from the water pages, which load for it; the wave
runs five tiles a second, destroys the buildings it reaches and stays a minute
and a half on each tile. The lake drains in three minutes; churches and the
Kloster that lay in it come back as ruins, the rest is gone.

**State and offline.** The save is in the IndexedDB database
`waldstatt-games` ([ADR 0003](decisions/0003-save-the-waldstatt-in-indexeddb.md)):
a record with the settlement (stock, marks and planned cobbles, buildings with
their crew, condition, graves and how far they sank, the flood's level and the
wave, the camera, the tools, where the saw lies, the seed and positions of the
hidden texts, the explored texts, what appeared in the build menu, the goods
seen, motivation and its passing events, and the tombstones), a record with
the people, where they stand and how they are, and one record per chunk with
its felled trees and cobbles as bitsets and its seedlings as bytes. What a
Waldmensch is doing is not saved; they look for work anew. A text's length
follows its current text on load, so changed texts need no migration. The game
saves two seconds after a change, every ten seconds while the page shows, and
when it is hidden; only chunks that changed are written. The organization's
Pages sites share one origin (the games save under `moto-devil/` and
`car-drive/` in `localStorage`), so the save is validated on load, a broken
save starts a new forest with a notice, and «Neu beginnen» deletes the
database and any old keys starting with `waldstatt-games/`, but not the saved
forests below nor the keymap in `waldstatt-games-settings` (ADR 0005). The installed app
asks the browser to keep its storage. Each tab holds the database open; when
one tab resets the forest or loads another, the others let go of it and stop
saving, so they cannot write their old forest back, and say so. If the database does not open
within five seconds, as when an older tab still holds it, the page starts a
fresh forest without saving and says why. If the start fails otherwise, the
still picture shows the error instead of waiting silently. The manifest's start URL and scope and
the service worker's scope are the base path. The
worker's cache is named after the build; it fetches the page network-first and
serves files under the base path and Astro's `_astro/` assets cache-first,
ignoring `Vary` because those URLs carry content hashes. On the first visit the
page hands the worker the files it already loaded, so the next start works
offline. The worker is not registered in development.

**Saved forests and files.** «Wälder speichern und laden …» in the menu, or
`:wälder` in the finder, opens the dialog «Wälder»
([ADR 0004](decisions/0004-keep-named-waldstatt-saves-and-files.md),
[pitch](../pitches/pitch--waelder-speichern.md)). It saves the
forest being played under a name, as a snapshot of the whole save (the
settlement, the people and every chunk), in the IndexedDB database
`waldstatt-games-saves`, one record per name with the time and the counts of
Waldleute and buildings; names are cleaned of control characters and cut to
60 characters, and at most 200 forests are kept. Saving under a name that
exists asks first. The list shows the forests newest first, each with «Laden»,
«Herunterladen» and «Löschen»; loading and deleting ask first. Loading checks
the snapshot with the save's own checks, stops this page's saving, opens
`waldstatt-games` at the next version so other tabs let go, replaces its
records in one transaction, and reloads the page; if that fails, the old forest
stays and the page says so. «Diesen Wald herunterladen» and «Herunterladen»
offer a JSON file, `waldstatt-<name>-<day>.json`, with `format:
"waldstatt-games"`, the name, the time, the save's records and the chunks'
bytes in base64. «Wald aus Datei …» reads such a file of at most 32 MB, checks
it like the save, adds it to the list under its name (numbered if the name is
taken) and offers to load it. Snapshots and files of another save version are
refused. The «:» finder has the same actions: `wald:speichern`,
`wald:herunterladen`, `wald:aus-datei`, and `wald:laden:…`,
`wald:herunterladen:…` and `wald:löschen:…` for each saved forest, named in
lower case with hyphens and hinted with the time it was saved. Each opens the
dialog first, so its status line and confirmations show; `wald:aus-datei`
opens the file picker straight from the key or tap, as browsers require. The
finder knows the saved forests from the start of the page and after each
change in the dialog; one saved in another tab shows after a reload.

**Access.** The map is a focusable `role="application"`. Keys follow a keymap
that visitors change in the dialog «Tasten» (ADR 0005); by default arrow keys,
h, j, k, l or s, e, i, u (the Neo layout's left, right, down, up) move a cursor
tile along the squares' edges (→ and ← along x, ↑ and ↓
along y, so every tile is reached), at an even pace while held, and the view glides after it once it leaves the middle half of the
screen; digits typed before a movement are a count, so «10» and then → moves
ten tiles, and a badge shows the count until it is used or Escape drops it;
with Shift they pan smoothly; + and − zoom; v starts a rectangle for
the saw or paving at the cursor and o jumps to its other corner, as in vim;
Enter or Space applies the tool or opens a
building, Escape cancels (`input.ts`). Jumps of the view take the cursor
along: to the first clearing (`/start`, `:lichtung`, the menu), and onto a
text or the stage unless it is on it already. Turning back from a text leaves
the cursor where it is: the view returns to where it was if the cursor did
not move, and otherwise turns onto the cursor. Anywhere outside text fields and
dialogs, a, g, p and x choose Axt, Säge, Pflastern and Abreissen, b opens
Bauen and m the menu, which lists these keys and opens «Tasten». The map's
description and the menu's list are written from the keymap. In «Tasten»,
each action can have several keys, but a key only one action: adding a key
another action has is refused, naming it. Escape, Tab, the digits and keys
with Ctrl, Alt or Cmd cannot be bound.

**Text mode.** On a text already read top-down (after «/», or Enter on it),
Enter with the keyboard cursor on the text starts the text mode: the cursor
becomes a text cursor, as in vim's normal mode (`textCursor.ts`), a block on
the text's first character.
By default h, j, k, l and the arrows move it by characters and lines, w, b and
e by words, gg to the start and G to the last line, each as often as the
count typed before («5gg» and «5G» go to the fifth line). v selects
characters and V whole lines; o jumps to the selection's other end, y or
Ctrl+C copies it and returns to the start of the selection. Escape steps back
one level at a time: out of the selection, out of the text mode (the map
cursor shows again), and then out of the top-down view. Lines are the lines as they wrap, found from
the characters' boxes; a new block parts words. The view pans after the
cursor. Lines and words reached are announced. The cursor and the selection
are CSS highlights on both inks; a browser without them shows the document
selection. The text mode's keys are a scope of their own in the keymap, where
Shift counts, and go before the others while it is on: b moves back a word
instead of opening Bauen. Map movement keys rest; zooming, the tools, the
menus and the finders still work. With a mouse there is no text mode. The keymap is kept in the database
`waldstatt-games-settings`, which resets and loading leave alone. A menu
closed with Escape returns focus to where it was opened from: its button when
clicked, the map when its key or the finder opened it. «/» opens a finder over the
starting point (`start`) and the texts found so far and jumps to the one
chosen; «:» one over commands:
`tool:…` for the tools at hand, `build:…` for the buildings the menu shows,
`lichtung`, `bauen`, `menü`, `wälder`, `tasten` and `neu-beginnen`, and `wald:…` for
the saved forests (see below). Both match fuzzily, ignoring
accents, and take arrows or Tab, Enter and Escape. While the view is turned onto the stage,
the keys from the game's controls play it instead. Every tool, menu item and
link is a real button or link with a German name; status, finished buildings,
the stage's status while somebody plays, and events such as births, deaths
and stocks running out are announced politely,
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
