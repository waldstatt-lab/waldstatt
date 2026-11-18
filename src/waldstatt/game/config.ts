/**
 * The game's one balance table: the goods and their stock limits, what each
 * building costs, how big it is, how long it takes to build, what it makes
 * from what, when it appears in the build menu, and how fast the Waldleute
 * live, eat, work and age. Tune the game here; nothing else holds numbers
 * like these.
 */

/** World units per tile; the art is drawn at one pixel per world unit. */
export const TILE = 16;
/** Tiles per chunk side. */
export const CHUNK = 32;

export const balance = {
  /** Wood from one felled tree. */
  woodPerTree: 1,
  /** Seconds a Waldmensch needs to fell a tree, at normal motivation. */
  fellSeconds: 1.4,
  /** Tiles per second a Waldmensch walks. */
  walkSpeed: 4,
  /** Waldleute that can work on one building site at once. */
  workersPerSite: 3,
  /** Share of the costs returned when a building is torn down. */
  refund: 0.5,
  /** Share of the costs a ruin's repair takes. */
  repair: 0.5,
  /** Trees the saw marks at most in one stroke. */
  sawMaxTiles: 600,
  /** Water tiles a bridge spans at most. */
  bridgeMaxSpan: 5,
  /** Tiles per second a ship sails. */
  shipSpeed: 3,
  /** What boarding a ship costs a Waldmensch who looks for a way, in tiles walked. */
  boardingCost: 6,
  /** Tiles a Waldmensch searches at most when looking for a way to work. */
  searchTiles: 40000,
  /** The saw appears once a hut stands and this many trees are felled. */
  sawAfterTrees: 100,
  /** How far ahead of the clearing a raven circles, in tiles (500 m). */
  ravenLead: 10,
  /** Tiles per second a raven flies. */
  ravenSpeed: 6,
  /** Waldleute one producing building takes at most. */
  maxCrew: 4,
  /** Seconds to pave one tile, which takes one stone. */
  paveSeconds: 0.8,
  /** Tiles the paving tool plans at most in one stroke. */
  paveMaxTiles: 600,
  /** How much faster Waldleute walk on cobbles. */
  pavedSpeed: 1.5,

  // --- People ---------------------------------------------------------------
  /** Reach of food, churches and the Kloster, in tiles (1 km). */
  reach: 20,
  /** Seconds of play per year of a Waldmensch's life. */
  yearSeconds: 40,
  /** Children work from this age on. */
  workingAge: 14,
  /** Women and men have children between these ages. */
  fertile: [16, 42] as const,
  /** A life ends of age somewhere between these years. */
  lifeYears: [60, 80] as const,
  /** Seconds between meals; after them, a Waldmensch is hungry. */
  mealSeconds: 45,
  /** Children get hungry this much as fast as adults. */
  childAppetite: 0.5,
  /** Seconds a hungry Waldmensch survives without a meal. */
  starveSeconds: 240,
  /** Seconds, on average, between a woman's children while food is plenty. */
  birthSeconds: 70,
  /** The shortest time between two children of one woman. */
  birthPause: 40,
  /** With beer in stock, children come this much sooner. */
  birthBeer: 0.6,
  /** Children come only while the food in stock is at least this many meals per Waldmensch. */
  birthFood: 1,
  /**
   * No more Waldleute than this, for the sake of slow devices: at 1000, the
   * rules take about 1.3 ms a frame in a desktop browser.
   */
  maxPeople: 1000,
  /** The fire in the first clearing gives shelter to two. */
  fireBeds: 2,
  /** What lies by the fire at the start. */
  startFood: 30,
  /** While overcrowded, the years pass this much faster. */
  crowdedAgeing: 1.5,

  // --- Motivation -------------------------------------------------------------
  /** Motivation in percent with nothing to raise or lower it. */
  moodBase: 50,
  /** Seconds motivation takes to follow most of the way to where it tends. */
  moodDrift: 20,
  /** Work speed at 0 and at 100 percent motivation. */
  moodSpeed: [0.5, 1.5] as const,
  /**
   * Children with motivation: below the base they fall off with this power
   * of motivation over the base (2: half the base, a quarter of the
   * children); above it they rise to this many times at 100 percent.
   */
  moodBirths: { power: 2, max: 1.5 },
  /** What raises or lowers motivation while it lasts, in percent. */
  mood: {
    kirche: 8,
    /** Churches count only up to this many. */
    churches: 3,
    kloster: 10,
    ise: 8,
    /** Per Spielhaus with beer, and without. */
    beer: 4,
    dry: -6,
    /** At most, when far more Waldleute live than there are beds. */
    crowded: -25,
    /** At most, when everybody is hungry. */
    hungry: -15,
  },
  /** Events that raise or lower motivation for a while: percent and seconds. */
  moodEvents: {
    lonelyDeath: [-10, 180] as const,
    play: [12, 120] as const,
    brot: [25, 240] as const,
  },

  // --- Upkeep, beer and Brot auswerfen ------------------------------------------
  /** Seconds between two rounds of upkeep for the Klause, churches and the Kloster. */
  upkeepSeconds: 60,
  /** Condition lost in a round without what is needed. */
  decay: 0.05,
  /** Condition regained in a round with it. */
  mend: 0.1,
  /** Below this condition, a building no longer has its effect. */
  working: 0.5,
  /** Seconds one Spielhaus or the theatre drinks one beer. */
  beerSeconds: 90,
  /** Loaves thrown at a Brot auswerfen, and seconds per loaf. */
  brotLoaves: 100,
  brotSeconds: 1.2,
  /** Waldleute within this many tiles of the stage catch bread. */
  brotCatch: 8,
  /** Graves in one graveyard. */
  graves: 12,

  // --- The forest growing back ------------------------------------------------------
  /** Seconds, on average, before felled ground beside forest grows a seedling. */
  sproutSeconds: 600,
  /** Seconds a seedling takes to become a tree. */
  growSeconds: 240,
  /** Seconds a walked-on tile keeps seedlings from sprouting or growing up. */
  trodSeconds: 120,

  // --- The Sihlsee and the flood wave ---------------------------------------------------
  /** Seconds the Sihlsee takes to fill, and to drain once the dam is gone. */
  fillSeconds: 900,
  drainSeconds: 180,
  /** Seconds a building takes to sink once the water reaches it. */
  sinkSeconds: 90,
  /** Height above the ground, in world units, up to which drowned buildings vanish. */
  waterline: 70,
  /** Tiles per second the flood wave runs down the Sihl, and seconds it stays. */
  waveSpeed: 5,
  waveStays: 90,
  /** Tiles on each side of the Sihl the wave floods. */
  waveBand: 2.5,
} as const;

// --- Goods -----------------------------------------------------------------------

export type Good =
  | "wood"
  | "stones"
  | "parchment"
  | "books"
  | "grain"
  | "flour"
  | "bread"
  | "meat"
  | "beer";

/** The goods, in the order the resource bar names them, with their stock limits. */
export const goods: { key: Good; name: string; max: number }[] = [
  { key: "wood", name: "Holz", max: 9999 },
  { key: "stones", name: "Steine", max: 300 },
  { key: "parchment", name: "Pergament", max: 30 },
  { key: "books", name: "Bücher", max: 20 },
  { key: "grain", name: "Getreide", max: 60 },
  { key: "flour", name: "Mehl", max: 40 },
  { key: "bread", name: "Brot", max: 200 },
  { key: "meat", name: "Fleisch", max: 60 },
  { key: "beer", name: "Bier", max: 40 },
];

export const goodKeys = goods.map((g) => g.key);
export const goodName = (key: Good) =>
  goods.find((g) => g.key === key)?.name ?? key;
export const goodMax = (key: Good) =>
  goods.find((g) => g.key === key)?.max ?? 0;

/** What Waldleute eat. */
export const foods: Good[] = ["bread", "meat"];

export type Stock = Record<Good, number>;
export type Cost = Partial<Stock>;

export const emptyStock = (): Stock => ({
  wood: 0,
  stones: 0,
  parchment: 0,
  books: 0,
  grain: 0,
  flour: 0,
  bread: 0,
  meat: 0,
  beer: 0,
});

// --- Buildings ----------------------------------------------------------------------

export type Kind =
  | "huette"
  | "steinhaus"
  | "schafweide"
  | "getreidehof"
  | "viehhof"
  | "muehle"
  | "baeckerei"
  | "brauerei"
  | "steinbruch"
  | "druckerei"
  | "spielhaus"
  | "bibliothek"
  | "theater"
  | "klause"
  | "kirche"
  | "friedhof"
  | "kloster"
  | "ise"
  | "brot"
  | "damm"
  | "bruecke"
  | "hafen"
  | "schiff";

export type Group =
  "Wohnen" | "Nahrung" | "Handwerk" | "Wege" | "Spiele" | "Glaube" | "Prestige";

export const groups: Group[] = [
  "Wohnen",
  "Nahrung",
  "Handwerk",
  "Wege",
  "Spiele",
  "Glaube",
  "Prestige",
];

/** When a building first appears in the build menu; it stays from then on. */
export interface Appears {
  /** Living Waldleute at least. */
  people?: number;
  /** Each of these stands finished. */
  all?: Kind[];
  /** One of these stands finished. */
  any?: Kind[];
}

export interface KindInfo {
  name: string;
  group: Group;
  cost: Cost;
  /** Footprint in tiles; a bridge is as long as the river is wide. */
  w: number;
  h: number;
  /** Seconds of work for one Waldmensch. */
  work: number;
  /** "one": a single one; "game": one per game; "many": any number. */
  limit: "one" | "game" | "many";
  appears?: Appears;
  /** Beds for Waldleute. */
  beds?: number;
  /** What it uses per round of upkeep; without it, it decays. */
  upkeep?: { food: number; books: number };
  /** Waldleute eat within reach of it. */
  food?: boolean;
}

export const kinds: Record<Kind, KindInfo> = {
  huette: {
    name: "Hütte",
    group: "Wohnen",
    cost: { wood: 8 },
    w: 2,
    h: 2,
    work: 6,
    limit: "many",
    beds: 4,
  },
  steinhaus: {
    name: "Steinhaus",
    group: "Wohnen",
    cost: { wood: 20, stones: 30 },
    w: 3,
    h: 3,
    work: 24,
    limit: "many",
    appears: { people: 100 },
    beds: 12,
  },
  viehhof: {
    name: "Viehhof",
    group: "Nahrung",
    cost: { wood: 16 },
    w: 5,
    h: 4,
    work: 10,
    limit: "many",
    food: true,
  },
  getreidehof: {
    name: "Getreidehof",
    group: "Nahrung",
    cost: { wood: 14 },
    w: 5,
    h: 4,
    work: 10,
    limit: "many",
  },
  muehle: {
    name: "Mühle",
    group: "Nahrung",
    cost: { wood: 20, stones: 6 },
    w: 3,
    h: 3,
    work: 14,
    limit: "many",
    appears: { all: ["getreidehof"] },
  },
  baeckerei: {
    name: "Bäckerei",
    group: "Nahrung",
    cost: { wood: 16, stones: 8 },
    w: 3,
    h: 3,
    work: 14,
    limit: "many",
    appears: { all: ["getreidehof"], people: 10 },
    food: true,
  },
  brauerei: {
    name: "Brauerei",
    group: "Nahrung",
    cost: { wood: 20, stones: 6 },
    w: 3,
    h: 3,
    work: 14,
    limit: "many",
    appears: { all: ["getreidehof"], people: 20 },
  },
  schafweide: {
    name: "Schafweide",
    group: "Handwerk",
    cost: { wood: 12 },
    w: 4,
    h: 3,
    work: 6,
    limit: "many",
  },
  steinbruch: {
    name: "Steinbruch",
    group: "Handwerk",
    cost: { wood: 20 },
    w: 4,
    h: 3,
    work: 12,
    limit: "many",
  },
  druckerei: {
    name: "Druckerei",
    group: "Handwerk",
    cost: { wood: 20, parchment: 4, stones: 10 },
    w: 3,
    h: 3,
    work: 14,
    limit: "many",
  },
  spielhaus: {
    name: "Spielhaus",
    group: "Spiele",
    cost: { wood: 24, parchment: 4 },
    w: 5,
    h: 4,
    work: 16,
    limit: "game",
    appears: { all: ["brauerei"] },
  },
  bibliothek: {
    name: "Bibliothek",
    group: "Spiele",
    cost: { wood: 20, stones: 12, books: 4 },
    w: 4,
    h: 3,
    work: 16,
    limit: "game",
  },
  theater: {
    name: "Theater",
    group: "Spiele",
    cost: { wood: 40, stones: 16, books: 4 },
    w: 12,
    h: 13,
    work: 24,
    limit: "one",
    appears: { all: ["brauerei", "spielhaus"] },
  },
  klause: {
    name: "Meinrads Klause",
    group: "Glaube",
    cost: { wood: 20 },
    w: 3,
    h: 3,
    work: 14,
    limit: "one",
    upkeep: { food: 1, books: 1 },
  },
  kirche: {
    name: "Kirche",
    group: "Glaube",
    cost: { wood: 40, stones: 40, books: 4 },
    w: 4,
    h: 6,
    work: 40,
    limit: "many",
    appears: { all: ["druckerei"], people: 20 },
    upkeep: { food: 1, books: 1 },
  },
  friedhof: {
    name: "Friedhof",
    group: "Glaube",
    cost: { wood: 10, stones: 6 },
    w: 3,
    h: 3,
    work: 8,
    limit: "many",
    appears: { any: ["kirche", "kloster"] },
  },
  kloster: {
    name: "Kloster Einsiedeln",
    group: "Glaube",
    cost: { wood: 80, stones: 120, books: 10 },
    w: 9,
    h: 7,
    work: 90,
    limit: "one",
    appears: { all: ["druckerei"], people: 50 },
    upkeep: { food: 2, books: 1 },
  },
  ise: {
    name: "ISE AG",
    group: "Prestige",
    cost: { wood: 20, stones: 30, books: 6 },
    w: 3,
    h: 3,
    work: 30,
    limit: "one",
    appears: { all: ["druckerei"] },
  },
  brot: {
    name: "Brot auswerfen",
    group: "Prestige",
    cost: { wood: 20 },
    w: 3,
    h: 2,
    work: 10,
    limit: "one",
    appears: { all: ["baeckerei"] },
  },
  damm: {
    name: "Damm",
    group: "Prestige",
    cost: { wood: 30, stones: 80 },
    w: 7,
    h: 2,
    work: 40,
    limit: "one",
  },
  bruecke: {
    name: "Brücke",
    group: "Wege",
    cost: { wood: 6 },
    w: 1,
    h: 1,
    work: 5,
    limit: "many",
  },
  hafen: {
    name: "Hafen",
    group: "Wege",
    cost: { wood: 12, stones: 6 },
    w: 3,
    h: 2,
    work: 10,
    limit: "many",
  },
  schiff: {
    name: "Schiff",
    group: "Wege",
    cost: { wood: 12 },
    w: 2,
    h: 1,
    work: 8,
    limit: "many",
  },
};

/** What a producing building makes from what, per round of `seconds` of one Waldmensch's work. */
export interface Recipe {
  takes: Cost;
  makes: Cost;
  seconds: number;
}

export const recipes: Partial<Record<Kind, Recipe>> = {
  schafweide: { takes: {}, makes: { parchment: 1 }, seconds: 12 },
  getreidehof: { takes: {}, makes: { grain: 1 }, seconds: 6 },
  viehhof: { takes: {}, makes: { meat: 1 }, seconds: 15 },
  muehle: { takes: { grain: 1 }, makes: { flour: 1 }, seconds: 5 },
  baeckerei: { takes: { flour: 1 }, makes: { bread: 2 }, seconds: 8 },
  brauerei: { takes: { grain: 1 }, makes: { beer: 1 }, seconds: 8 },
  steinbruch: { takes: {}, makes: { stones: 1 }, seconds: 5 },
  druckerei: {
    takes: { parchment: 1, wood: 2 },
    makes: { books: 1 },
    seconds: 8,
  },
};

/** The buildings Waldleute are put in to work. */
export const crewKinds = Object.keys(recipes) as Kind[];

/** The buildings that bring a raven: Meinrad kept two. */
export const ravenKinds: Kind[] = ["klause", "kloster"];

/** Buildings that keep their stone walls under water and come back as ruins. */
export const stoneKinds: Kind[] = ["kirche", "kloster"];

/**
 * The ISE AG's colours, from its logo: the magenta of «ISE» and its first
 * dot, a grey of its dots, and the grey of its tagline. The ISE AG agreed to
 * its logo and design being shown; the logo itself is `ise-logo.png`.
 */
export const iseColours = {
  magenta: "#b10058",
  dot: "#bebebe",
  tagline: "#646363",
};

/**
 * The texts that lie hidden in the forest. Each lies under trees until the
 * Waldleute fell them; it is found with its first felled tree and explored
 * once all its trees are felled. Width in tiles; the length follows the text.
 */
export type TextKind = "ortstafel" | "chronik" | "game";

export const texts: Record<
  TextKind,
  {
    name: string;
    /** Width in tiles on narrow screens and on wide ones. */
    w: { narrow: number; wide: number };
    style: "board" | "scroll";
    /** Where it lies: within 1 km of the Klosterplatz, or 1.5 to 5 km out. */
    where: "town" | "far";
  }
> = {
  ortstafel: {
    name: "Ortstafel",
    w: { narrow: 6, wide: 9 },
    style: "board",
    where: "town",
  },
  chronik: {
    name: "Chronik",
    w: { narrow: 8, wide: 12 },
    style: "scroll",
    where: "town",
  },
  game: {
    name: "Schriftrolle",
    w: { narrow: 8, wide: 13 },
    style: "scroll",
    where: "far",
  },
};

/**
 * A text's width in tiles: wider on wide screens, so lines are long enough on
 * a desktop and the text still fills a phone at a readable size. Chosen once
 * when the page starts.
 */
export function textWidth(kind: TextKind): number {
  const wide =
    typeof window !== "undefined" &&
    Math.min(window.screen.width, window.innerWidth) >= 900;
  return wide ? texts[kind].w.wide : texts[kind].w.narrow;
}

/** Distances of hidden texts from the Klosterplatz, in tiles. */
export const placing = {
  town: { min: 0, max: 20 },
  far: { min: 30, max: 100 },
  /** Free tiles kept round each text and round the first clearing. */
  gap: 3,
};

/** Text pixels per tile for texts lying on the ground, and their margin in tiles. */
export const TEXT_SCALE = 32;
export const TEXT_MARGIN = 0.3;

/**
 * The theatre: a wooden amphitheatre. Its stage lies in the middle; tiered
 * stands rise all round it. In tiles from the footprint's corner.
 */
export const STAGE = {
  u0: 2.5,
  v0: 2.4,
  u1: 9.5,
  v1: 10.4,
  rows: 3,
  row: 0.75,
};
