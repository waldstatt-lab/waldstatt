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
| `game/sim.ts` | The rules: the tools on the ground, marking and felling, the hidden texts, Waldleute and their tasks (walking back to eat included), bridges, ports and ships, building sites, repairs and clearing ruins as work, refunds and the Recyclinghof's reach, placing rules, what the build menu shows, the ravens; it steps the systems below in turn |
| `game/economy.ts` | The goods: the shared stock and its limits, the crews and recipes of the producing buildings, beer for the Spielhäuser and the theatre, the upkeep of the Klause, the churches and the Kloster, the Brot auswerfen |
| `game/people.ts` | The Waldleute's lives: ages, meals and where food reaches, children, deaths, graves and tombstones, beds, the fire and the first pair |
| `game/mood.ts` | Motivation: where it tends with what stands and how worn it is, passing events, and the work speed it sets |
| `game/wear.ts` | Wear: every finished building's condition, its most by material and size, the wear levels the art shows, falling into ruins, and what a repair costs and tearing down gives back; covered by unit tests (`wear.test.ts`) |
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
| `game/commands.ts` | The commands ([ADR 0006](decisions/0006-make-waldstatt-actions-commands-that-keys-bind-to.md), [ADR 0008](decisions/0008-pass-waldstatt-command-values-in-parentheses.md)): the registry, reading commands and chains with their values, running them with a count, macros, recording, and the scripts' commands supplied from outside |
| `game/commandText.ts` | How a command is written: its segments, values in parentheses, texts in quotes, chains split outside texts, and the finder's shortcut `up 15` |
| `game/notices.ts` | The notices over the map from `notify:`, `say` and scripts' failures |
| `game/commandSet.ts` | Every command of the game and what it does through the interface |
| `game/keymap.ts` | The keymap ([ADR 0005](decisions/0005-keep-the-waldstatt-keymap-in-a-settings-database.md), ADR 0006): key names, the default bindings, contexts and their expressions, the visitor's layer and macros, checking JSON, converting version 1, and keeping it in the database `waldstatt-games-settings` |
| `game/dispatch.ts` | The key dispatcher: counts, sequences, contexts, held movements and Shift to pan |
| `game/keysDialog.ts` | The dialog «Tasten»: the bindings by context, recording a new one, the macros, and the keymap as JSON and as a file |
| `game/textCursor.ts` | The text mode on a text read top-down, as vim's normal and visual modes: a block cursor moved by characters, lines, words, gg and G with counts, selections by character (v) or line (V), o, and copying, drawn as CSS highlights |
| `game/ui.ts` | The HTML interface: tools and menus, placing, the map's handlers, what the commands do, reading on the map, and announcements |
| `game/card.ts` | The card over a building: state, condition, stock, crew, repair and clearing away |
| `game/finder.ts` | The finders «/» and «:» over the commands |
| `game/buildMenu.ts` | The build menu's pictures and buttons |
| `game/keysHelp.ts` | The help texts written from the keymap |
| `game/dom.ts` | Small DOM helpers and the finders' fuzzy matching |
| `game/script/parse.ts`, `check.ts`, `compile.ts`, `machine.ts` | The script language ([ADR 0007](decisions/0007-run-waldstatt-scripts-in-a-language-of-our-own.md)): reading a script into its syntax tree (`ast.ts`), checking names, imports and the separation of commands and queries, compiling to instructions, and the machine that runs them with a state that can be saved |
| `game/script/runtime.ts` | Starting, stepping and keeping the scripts' runs, with their programs, `every` and the step budget |
| `game/script/queries.ts` | The game's queries for scripts, the fields of buildings, and when a command's work is done |
| `game/scriptsDialog.ts`, `scriptEditor.ts` | The dialog «Skripte», and the editor, CodeMirror 6 with the language's mode, completion, errors and vim's keys, loaded only when it opens |
| `game/vimClipboard.ts` | Vim's yank and paste in the editor through the system clipboard |
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
100 trees are felled, where the last of them fell. Both are one tool,
«Holzhacken», missing from the toolbox until the axe is picked up: a tap marks
or unmarks a single tree; once the saw is picked up, it upgrades the tool, whose
icon turns into the saw, and a drag marks every tree in the dragged area (two
fingers or another mouse button pan meanwhile), while a tap still marks one.
An area that begins on a marked tree, dragged or selected with the keyboard,
unmarks every marked tree in it instead, drawn pale rather than red; with «Abreissen», a first
tap marks a building in red and a second tap on it tears it down. Only within
10 km of a finished Recyclinghof does that return anything: half its costs, less
as far as it is worn; a site nobody worked on yet returns its whole costs. With
«Reparieren» (shown once a building stands that wears), a tap orders a
building's repair (see **Wear and repair**). Waldleute walk only on open ground: felled forest, the natural gaps,
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
decay a twentieth of their condition a minute on top of their wear, lose their
effect below half (the raven leaves), and fall into ruins. Ruins lower
motivation by 4 % each, at most 20 %; the average condition of the other
finished buildings lowers it below 50 %, up to 15 % at none, and raises it
above 80 %, up to 6 % when all are sound. A Spielhaus and the theatre drink beer;
without it they are shut, and their play link and stage do not open. The
Brot auswerfen waits for 100 loaves, then throws them one by one to the
hungriest nearby and takes itself down. While it throws, a crowd as large as
the settlement (5 to 16) stands cheering in front of the stage, two Waldleute
on it throw, and each loaf flies in an arc to somebody who jumps to catch it;
the crowd is drawn only, it takes nobody from work (`render.ts`).

**Wear and repair** (`wear.ts`). Every finished building but the Brot
auswerfen loses a point of condition a year of play (40 seconds). Its most
condition, the years it lasts from new, is set by its material and grows with
the square root of its footprint: 6 for fields and pens, 20 for wood, 32 for
wood and stone, 50 for stone, each for 2 × 2 tiles. So a Getreidehof lasts 13
years, a hut 20, a Steinhaus 75 and the Kloster 198. The condition is saved as
a share of the most. Below two thirds a building looks worn (stains, moss,
streaks), below a third crumbling (cracks, holes, grime) and is announced as
«baufällig»; at none it falls into ruins: its upper part falls in, rubble lies
in and before it, fields go to weeds, and it does nothing more (no beds, crew,
effect, crossing or ship). A worn-out dam breaks and sends the flood wave. The
pictures are the building's art with the wear painted over by `weathered()` in
`art.ts` and `weatheredPlan()` in `plan.ts`, the same for a kind and size every
time, and cached per level. A building's card shows «Zustand: 15 von 75,
baufällig». A repair, ordered with the tool, the card or the finder, costs
half the building's costs as far as it is worn, rounded up, paid at once;
Waldleute then work on it from beside it like a site, scaffolded with a bar,
and a full repair takes as long as building it. A ruin cannot be repaired or
rebuilt; it stands, weighing on motivation, until it is cleared away with
«Abreissen», the card's «Wegräumen» or `:clear:ruins`, which needs a
Recyclinghof within 10 km, gives nothing back and takes four times its
building work. A building that is one of a kind cannot be built again while
its ruin stands. The Recyclinghof (Handwerk, 30 Holz and 20 Steine)
appears once a Steinbruch stands. Balance lives in `config.ts`.

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
the ISE AG with a Druckerei, the Recyclinghof with a Steinbruch, the Brot auswerfen with a Bäckerei, the dam once
every tree on its site is felled, and the Steinhaus at 100 Waldleute. A dot on
«Bauen» marks that something appeared, until the menu is opened. Content
buildings are one of a kind (per game for a game's buildings). Nothing on the
map opens a panel or dialog: a tap on a building turns the view to its text or
stage, or opens its game or source; otherwise it opens a small card on the map
above the building with its state, condition and stock, − and + for a crew,
its repair, or a ruin's clearing away. A tap anywhere else, the card's ×, or Escape closes it. Other
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
their crew, condition, an ordered repair or clearing, graves and how far they sank, the flood's level and the
wave, the camera, the tools, where the saw lies, the seed and positions of the
hidden texts, the explored texts, what appeared in the build menu, the goods
seen, motivation and its passing events, the tombstones, the clock of play,
and the scripts' runs with their programs and the scripts switched on), a record with
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
refused. The same actions are commands: `forest:open`, `forest:save`,
`forest:download`, `forest:from-file`, and `forest:load:…`,
`forest:download-saved:…` and `forest:delete:…` for each saved forest, named
in lower case with hyphens. Each opens the dialog first, so its status line
and confirmations show; `forest:from-file` opens the file picker straight
from the key or tap, as browsers require. The commands know the saved
forests from the start of the page and after each change in the dialog; one
saved in another tab shows after a reload.

**Commands, keys and macros** ([ADR 0006](decisions/0006-make-waldstatt-actions-commands-that-keys-bind-to.md),
[pitch](../pitches/pitch--befehle-und-tasten.md)). Everything
the keyboard and the «:» finder do is a command in one registry
(`commands.ts`, `commandSet.ts`), named by colon segments: English
namespaces and verbs, names of things as the game names them, in lower case
with hyphens. Its values follow in parentheses, separated by commas
([ADR 0008](decisions/0008-pass-waldstatt-command-values-in-parentheses.md),
[pitch](../pitches/pitch--befehlswerte.md)): numbers, and
texts in double quotes with JSON's escapes (`notify:info("Hütte steht; gut")`),
read by one reader (`commandText.ts`) for the finder, the keymap, macros and
scripts, so `;` and `,` inside a text split nothing. A choice from a list may
stand as a segment (`build:hütte`) or in the parentheses (`build("hütte")`);
a value with a default may be left out (`up` is `up(1)`). The old form
`up:20` is refused with the new one named. `$waldstatt:` before a command
names the game's explicitly. Each describes itself in German, says why it cannot run now,
and says how a count combines with it. They are: `left`, `right`, `up`,
`down` (with a number of tiles), `zoom:in`, `zoom:out`, `goto:start` and
`goto:<text>`; `enter` (what Enter does at the cursor: apply the tool, open a
building, place the building being placed, begin or close an area, start the
text mode on a text read), `selection:start`, `selection:other`,
`selection:confirm` and `selection:cancel`; `tool:holzhacken`,
`tool:pflastern`, `tool:reparieren`, `tool:abreissen` and `tool:none`, which
choose rather than toggle; `menu:build`, `menu:main`, `find:texts`,
`find:commands`, `keys:open` and `game:reset`; `build:<building>`;
`repair:all`, `repair:worn`, `repair:crumbling`, `repair:under(<n>)` and
`repair:chosen` (the building whose card was open when the finder opened,
the open card's, or the one under the keyboard cursor), which order as many
repairs as the stock pays for, the most worn first, and fail when it pays for
none, and `clear:ruins`;
`card:repair`, `crew:more` and `crew:less` for an open card; the text mode's
`text:…`; the saved forests' `forest:…`; and `macro:record`, `macro:replay`,
`macro:run:<name>` and `macro:delete:<name>`; and `notify:info(<text>)` and
`notify:alert(<text>)`, which show a notice. A count typed before a key
replaces a command's first number if it has its default, or multiplies it
(`20` then ↑ is `up(20)`; `2` then a key bound to `up(20)` is `up(40)`),
runs a repeatable command so many times (`crew:more`, `zoom:in`), or is
dropped.

**Notices** (`notices.ts`): `notify:info`, `notify:alert`, a script's `say`
and a script that stops with an error show a notice over the map, top right
under the supplies (at the top on phones, whose supplies are in the menu),
and read it out through the live region. An info fades after six seconds;
an alert stays until its × closes it. A notice from a script names it and
offers «Skript öffnen», which opens it in the editor. At most four show, the
newest first, an info going before an alert; the same text again merges into
one with a count. They take no focus from the map, and their texts are set
as text.

A **macro** is a chain of commands joined by `;`, such as
`tool:holzhacken;selection:start;up(10);right(10);selection:confirm` or
`build:hütte;enter;right(3)`. It runs all its steps at once, in order, and
stops at the first that cannot run, saying which and why; what already
happened stays, and it never waits for the Waldleute's work. A count runs the
whole chain that many times. Commands that open a menu, a finder or a dialog,
or change keys or macros, cannot be steps. A macro has at most 200 steps and
a run at most 10,000, and a macro cannot run itself, directly or through
another. q (`macro:record`) starts a recording, shown in a badge «● Aufnahme»:
every command run meanwhile by key or finder is written down, even one that
fails there (it may work where the macro runs), its count folded in and moves
in a row added up (`20` then ↑ is `up(20)`), but not pointer input or the steps
inside a macro run. q again stops it and asks for
a name: named, it is kept and runs as `macro:run:<name>`; without, it stays
the last macro, which @ (`macro:replay`) runs.

**Keys** (`keymap.ts`, `dispatch.ts`): the keymap binds keys and sequences of
keys to commands or chains, in sections by context, in the shape of the Zed
editor's keymap. The contexts are `map` (always), `placing`, `reading` (a
text or the stage turned top-down), `text` (the text mode) and `card` (a
building's card is open), and expressions of them with `&&`, `||`, `!` and
parentheses. Of the bindings that apply, the innermost context wins (`text`
and `card` over `placing` and `reading` over `map`), then the visitor's over
the default, then the later. Keys are named `left`, `enter`, `space`,
`shift-up`, `f1`, and characters as typed (`g`, `G`, `+`); a sequence is keys
joined by spaces (`g g`). After a key that begins a longer sequence bound in
the current contexts, the dispatcher waits up to a second for the next one,
and a badge shows the keys so far. Digits typed first make a count, shown in
the same badge until it is used or Escape drops it. A letter typed with Shift
that is not bound as such counts as the letter, and a movement with Shift
pans the view smoothly instead; movements held down step at an even pace,
the text cursor follows the keyboard's own repeat, and other commands run
once per press. Keys on the map go to the dispatcher; on a card or its
buttons, too; elsewhere on the page outside text fields and dialogs, only
commands that work anywhere run (the tools, menus, finders and macro
recording). Escape, Tab, the digits and keys with Ctrl, Alt or Cmd cannot be
bound. The defaults: arrows, h j k l and s e i u (the Neo layout's left,
right, down, up) move the cursor on the map outside the text mode, v and o
select, Enter and Space are `enter`, + = − _ zoom, a p r x choose the tools,
b and m open Bauen and the menu, / and : the finders, q records and @
replays; in the text mode h j k l and the arrows, w b e, g g, G, v V, o and
y; on a card r repairs and + ↑ − ↓ change the crew. The map's description
for screen readers and the menu's key list are written from the keymap.

**Tasten.** The dialog «Tasten» (`keysDialog.ts`, from the menu or
`:keys:open`) lists the bindings in force by context, each with its keys, its
command and what it does, and × (a default is taken away with `null`). «+
Bindung» records a key or a sequence and takes a command or chain, checked
and described as it is typed, and a context; keys already bound there ask
before they are replaced. The macros are listed with their steps, to edit,
add or delete. «Als JSON bearbeiten» shows the visitor's own bindings and
macros as JSON, `{"bindings": [{"context": …, "bindings": {keys: command or
null}}], "macros": {name: steps}}`; «Übernehmen» checks it and lists each
problem with its line, «Herunterladen» saves it as `waldstatt-tasten.json`
and «Aus Datei …» reads one back. «Standard» brings the default bindings
back after asking and keeps the macros. The visitor's keymap and macros are
kept as version 2 in the database `waldstatt-games-settings`, which resets
and loading leave alone; a keymap of version 1 (keys per action) is
converted once. Everything read back, typed or loaded is checked: its size,
shape, contexts, keys and every command and step.

**Scripts** ([ADR 0007](decisions/0007-run-waldstatt-scripts-in-a-language-of-our-own.md),
[pitch](../pitches/pitch--skripte.md)). Players write scripts
in a small language of the game's own (`script/`), never evaluated as
JavaScript. One statement per line, `#` for comments, blocks closed with
`end`: `var`, assignment, `if … then … elif … else … end`, `for i in 1..10`
(both ends included), `for b in list`, `while`, `wait 30s`, `wait until
<query>`, `await <command>`, `timeout 2m … else … end`, `say`, `return` and
`stop`; at the top `import`, `every 30s` and `timeout 10m` for the whole
script (10 minutes of play by default); a timeout ends at its own time even
inside a longer one. Commands and queries stay apart,
checked before a script can run: commands, the game's as typed in the finder
with expressions as their values (`repair:under(n * 2)`, `build(kind)`) and
the script's own `cmd:name(a, b) … end` (names may have colons, as
`cmd:bauen:dorf(n)`), called as `name(1, 2)`, are statements and return
nothing; the checker knows each game command's values and refuses a wrong
number of them, a text for a number and a literal out of range; queries, the game's
(`stock.wood`, `people`, `beds`, `mood`, `cursor.x`, `tool`, `time`,
`buildings(kind)`, `building-at(x, y)`, `field-at(x, y)`, `marked-at(x, y)`, `count`, `min`,
`max`, `abs`, `floor`, `round`) and the script's own `qry:name(a) … return …
end`, are expressions and change nothing; `field-at` says what a field holds,
the first of `"unknown"` (its page of the map not loaded yet), `"building"`,
`"lake"` (a natural lake, the Sihlsee or the flood wave), `"river"`,
`"tree"` (also over a hidden text, so nothing hidden shows), `"seedling"` and
`"grass"`, and `marked-at` whether a tree there is marked for felling; a query holds no command, wait or `say`. So
`await place:hütte` waits until the hut stands and returns nothing; the hut
is queried afterwards. `place:<building>` places a building at the keyboard
cursor in one step. Each game command that leaves work says what «done»
means: a site finished, ordered repairs done, ruins gone; one that can no
longer be done fails the script there. Buildings reach scripts as ids, read
anew at each access; values are numbers, texts (with `{…}` for values
inside and `\"` for a quote), `true`, `false`, `none` and lists. Names may
contain hyphens, so subtraction needs spaces. The game and every script are
namespaces, marked with `$`: `$waldstatt:up(15)`, `$helfer:summe(4)`; such a
name needs no import. `import waldstatt`, which every new script starts with,
brings the game's names without `$`; `import helfer` a script's,
`import reihe, bauen:dorf as dorf from helfer` single names, and
`import helfer as h` renames a namespace for the script (`$h:…`). Without
`$`, a name is the script's own, then an imported one, then the game's; one
that two imports bring is refused where it is used, and where a script's name
hides the game's, the editor warns and names `$waldstatt:`. Scripts used
through `$` are linked like imports, at most 16, with circles refused. A script is checked and compiled to instructions for a machine with
an explicit stack, whose state is plain data. The runtime steps every run up
to 400 instructions a frame and 2,000 for all, in game time, so scripts pause
with the game; a script runs once at a time, at most eight at once, and one
with `every` starts again at that interval, from one second, at once when it
is first armed. Each run carries its own program, compiled when it began, so
editing a script leaves a run under way on its version («ältere Fassung»);
the next start runs the new one. Runs and their programs are saved with the
forest, so they continue after a reload, and saved forests and files carry
them; on load each program is compiled again from its own sources and must
match its hash, and each run must fit it, or it is dropped with a notice.
Failures and timeouts stop a run and show as an alert with the line. A script
that does not check is checked again once a game command it names answers
differently, as when a building appears in the build menu. Scripts
are unlocked once per visitor by typing the hidden command `niklaus:wirth`
in the finder; the unlock is kept in `waldstatt-games-settings` in a record
of its own (`unlocks`), not in the keymap's JSON. Until then the menu item,
the badge and the `script:` commands are hidden and nothing runs.
`scripts:disable:all` locks them again in every forest, stopping the runs of
the forest at hand, until `niklaus:wirth` is typed anew; the sources and each
forest's choice stay, and the runs saved with other forests wait. Sources are
kept by name with the keymap in `waldstatt-games-settings`, in its JSON and
files, the same in every forest; each forest switches on the scripts that
may run in it («In diesem Wald» in the dialog, `script:enable:<name>`,
`script:disable:<name>`, and `scripts:disable` for all at once), saved with
its runs, and switching one off ends its run. A command marked hidden is left out of the finder's list and the
completions and runs only when typed out. A script's `cmd:` definitions are
commands too, `$helfer:bauen:dorf(3)`: the finder lists those of the scripts
switched on in the forest, described by the comment above each; run from the
finder, a key or a macro, one starts a run at that definition with literal
values (a macro goes on at once), known by that command and once at a time.
A binding or macro to one whose script is switched off or gone is kept and
says why when used; the dispatcher caches no reading of them. `script:run:<name>`,
`script:stop:<name>`, `script:stop-all`, `script:edit:<name>` and
`scripts:open` are commands, so keys and the finder start and stop scripts; scripts may run any command that does not open a
menu, finder or dialog. The finder lists only the scripts each fits: those
switched on here for `script:run` and `script:disable`, those switched off
for `script:enable`, the running ones for `script:stop`; the others are
left out of the list (a choice marked unlisted) but still say why when typed
out. The dialog «Skripte» (from the menu, a badge «▶ 2
Skripte» while scripts run, or `:scripts:open`) lists each script with its
trigger and state (bereit, aus in diesem Wald, läuft, wartet, ältere Fassung,
Fehler), the switch «In diesem Wald», ▶ and ■,
editing and deleting, and makes new ones by name. The editor (CodeMirror 6,
`scriptEditor.ts`, loaded only when it opens) highlights the language,
completes keywords, the game's queries and commands with their values and
descriptions, the namespaces after `$` and their names after `$ns:`, the
script's own and fields after a dot, and marks the checker's errors and
warnings as they are typed; «Vim-Tasten» switches on `@replit/codemirror-vim`, loaded
then and remembered, with the selection drawn by CodeMirror, since vim's
keys hide the browser's own. As vim's `clipboard=unnamedplus`
(`vimClipboard.ts`), `y`, `d`, `c` and `x` also put their text on the system
clipboard and `p` pastes from it, so a yank survives a reload; a named
register such as `"a` stays apart, and where the browser refuses the
clipboard, the register works alone. While a macro or `.` plays, `p` pastes
the register as last read from or written to the clipboard, so its keys keep
their order. While the editor has focus, Escape is the editor's.
«Speichern und starten» saves and starts. The language, the machine and the
runtime are covered by unit tests (`script/*.test.ts`).

**Access.** The map is a focusable `role="application"`. The keyboard cursor
moves along the squares' edges (→ and ← along x, ↑ and ↓ along y, so every
tile is reached), and the view glides after it once it leaves the middle half
of the screen (`input.ts`). Jumps of the view take the cursor along: to the
first clearing (`/start`, `:goto:start`, the menu), and onto a text or the
stage unless it is on it already. Turning back from a text leaves the cursor
where it is: the view returns to where it was if the cursor did not move,
and otherwise turns onto the cursor. Escape cancels one thing at a time. A
menu closed with Escape returns focus to where it was opened from: its button
when clicked, the map when its key or the finder opened it.

**Text mode.** On a text already read top-down (after «/», or Enter on it),
Enter with the keyboard cursor on the text starts the text mode: the cursor
becomes a text cursor, as in vim's normal mode (`textCursor.ts`), a block on
the text's first character, driven by the `text:…` commands: by characters
and lines, by words, to the start (g g) and to the last line (G), each as
often as the count typed before («5gg» and «5G» go to the fifth line). v
selects characters and V whole lines; o jumps to the selection's other end,
y or Ctrl+C copies it and returns to the start of the selection. Escape
steps back one level at a time: out of the selection, out of the text mode
(the map cursor shows again), and then out of the top-down view. Lines are
the lines as they wrap, found from the characters' boxes; a new block parts
words. The view pans after the cursor. Lines and words reached are
announced. The cursor and the selection are CSS highlights on both inks; a
browser without them shows the document selection. With a mouse there is no
text mode.

**The finders.** «/» opens a finder over the starting point and the texts
found so far (the `goto` commands) and jumps to the one chosen; «:» one over
every command, each with what it does and the key bound to it, matched
fuzzily by its id, ignoring accents, and by the words of its description;
commands that cannot run now show greyed with the reason. What is typed runs
as it is when it reads as a command or a chain (`up(20)`,
`build:hütte;enter;right(3)`); `up 15` and `notify:info Hallo` read as
`up(15)` and `notify:info("Hallo")`, a number after a partial id fills the
command that takes one («rep 30» is `repair:under(30)`), and a command
written with values that do not fit says why instead of running another.
Chosen from the list, a command that needs values is put into the field to
be completed (`notify:info(`); `$` lists the scripts' commands. Both take arrows or
Tab, Enter and Escape. While the view is turned onto the stage,
the keys from the game's controls play it instead. Every tool, menu item and
link is a real button or link with a German name; status, finished buildings,
the stage's status while somebody plays, and events such as births, deaths
and stocks running out are announced politely,
and the texts on the map are in the page as a region «Im Wald». With reduced
motion Waldleute do not walk or swing their tools, ships do not sail visibly,
and the previews play no demonstration. Screen-reader users and search engines can hardly reach the
content: accepted in ADR 0002. The page weighs about
10 kB of HTML, a 190 kB script (most of it PixiJS, which loads its WebGL parts
as further chunks) and 20 kB of styles, gzipped; the water follows in pages of
about 1 kB. The script editor loads only when it opens, about 112 kB, and its
vim mode only when switched on, about 41 kB more.

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
