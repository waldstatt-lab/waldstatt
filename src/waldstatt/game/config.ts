/**
 * The game's one balance table: what each building costs, how big it is, how
 * long it takes to build, and how fast the Waldleute and sheep work. Tune the
 * game here; nothing else holds numbers like these.
 */

/** World units per tile; the art is drawn at one pixel per world unit. */
export const TILE = 16;
/** Tiles per chunk side. */
export const CHUNK = 32;

export const balance = {
  /** Wood from one felled tree. */
  woodPerTree: 1,
  /** Seconds a Waldmensch needs to fell a tree. */
  fellSeconds: 1.4,
  /** Tiles per second a Waldmensch walks. */
  walkSpeed: 4,
  /** Waldleute at the start; every hut adds one, up to the cap. */
  startWorkers: 1,
  maxWorkers: 16,
  /** Waldleute that can work on one building site at once. */
  workersPerSite: 3,
  /** Seconds for one sheep pasture to grow one parchment. */
  parchmentSeconds: 10,
  /** Seconds one Waldmensch in the printing house needs to print one book. */
  bookSeconds: 8,
  /** What one book takes. */
  bookParchment: 1,
  bookWood: 2,
  /** Stock limits. */
  maxParchment: 30,
  maxBooks: 20,
  /** Share of the costs returned when a building is torn down. */
  refund: 0.5,
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
  /** Seconds one Waldmensch in a quarry needs to break one stone. */
  stoneSeconds: 5,
  maxStones: 300,
  /** Waldleute one quarry or printing house takes at most. */
  maxCrew: 4,
  /** Seconds to pave one tile, which takes one stone. */
  paveSeconds: 0.8,
  /** Tiles the paving tool plans at most in one stroke. */
  paveMaxTiles: 600,
  /** How much faster Waldleute walk on cobbles. */
  pavedSpeed: 1.5,
} as const;

export type Kind =
  | "huette"
  | "schafweide"
  | "druckerei"
  | "steinbruch"
  | "spielhaus"
  | "bibliothek"
  | "theater"
  | "klause"
  | "kloster"
  | "damm"
  | "bruecke"
  | "hafen"
  | "schiff";

export type Group = "Wohnen" | "Wirtschaft" | "Wege" | "Spiele" | "Prestige";

export interface Cost {
  wood: number;
  parchment: number;
  stones: number;
  books: number;
}

/** The supplies, in the order the toolbox and the build menu name them. */
export const supplies: { key: keyof Cost; name: string }[] = [
  { key: "wood", name: "Holz" },
  { key: "parchment", name: "Pergament" },
  { key: "stones", name: "Steine" },
  { key: "books", name: "Bücher" },
];

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
  /** One short line for the build menu. */
  about: string;
}

const cost = (wood: number, more: Partial<Omit<Cost, "wood">> = {}): Cost => ({
  wood,
  parchment: 0,
  stones: 0,
  books: 0,
  ...more,
});

export const kinds: Record<Kind, KindInfo> = {
  huette: {
    name: "Hütte",
    group: "Wohnen",
    cost: cost(8),
    w: 2,
    h: 2,
    work: 6,
    limit: "many",
    about: "Ein Waldmensch mehr, der fällt und baut.",
  },
  schafweide: {
    name: "Schafweide",
    group: "Wirtschaft",
    cost: cost(12),
    w: 4,
    h: 3,
    work: 6,
    limit: "many",
    about: "Schafe geben Pergament für Spielhäuser und die Druckerei.",
  },
  druckerei: {
    name: "Druckerei",
    group: "Wirtschaft",
    cost: cost(20, { parchment: 4, stones: 10 }),
    w: 3,
    h: 3,
    work: 14,
    limit: "one",
    about:
      "Waldleute drucken hier Bücher aus Pergament und Holz, für Bibliotheken, das Theater und das Kloster.",
  },
  steinbruch: {
    name: "Steinbruch",
    group: "Wirtschaft",
    cost: cost(20),
    w: 4,
    h: 3,
    work: 12,
    limit: "many",
    about: "Waldleute brechen hier Steine für Pflaster und steinerne Bauten.",
  },
  spielhaus: {
    name: "Spielhaus",
    group: "Spiele",
    cost: cost(24, { parchment: 4 }),
    w: 5,
    h: 4,
    work: 16,
    limit: "game",
    about: "Hier wohnt das Spiel. Antippen öffnet es in einem neuen Tab.",
  },
  bibliothek: {
    name: "Bibliothek",
    group: "Spiele",
    cost: cost(20, { stones: 12, books: 4 }),
    w: 4,
    h: 3,
    work: 16,
    limit: "game",
    about:
      "Hier liegt der Quellcode des Spiels. Antippen öffnet ihn in einem neuen Tab.",
  },
  theater: {
    name: "Theater",
    group: "Spiele",
    cost: cost(40, { stones: 16, books: 4 }),
    w: 12,
    h: 13,
    work: 24,
    limit: "one",
    about:
      "Ein hölzernes Amphitheater: Auf der Bühne spielst du die Spiele an, deren Spielhaus steht.",
  },
  klause: {
    name: "Meinrads Klause",
    group: "Prestige",
    cost: cost(20),
    w: 3,
    h: 3,
    work: 14,
    limit: "one",
    about:
      "Die Klause des Einsiedlers Meinrad. Ein Rabe zeigt dir den Weg zum nächsten Spiel.",
  },
  kloster: {
    name: "Kloster Einsiedeln",
    group: "Prestige",
    cost: cost(80, { stones: 120, books: 10 }),
    w: 9,
    h: 7,
    work: 90,
    limit: "one",
    about:
      "Der grösste Bau der Waldstatt, mit einer Bibliothek voller Bücher. Mit ihm kommt ein zweiter Rabe.",
  },
  bruecke: {
    name: "Brücke",
    group: "Wege",
    cost: cost(6),
    w: 1,
    h: 1,
    work: 5,
    limit: "many",
    about:
      "Führt von Ufer zu Ufer über einen Fluss. Schwimmen können die Waldleute nicht.",
  },
  hafen: {
    name: "Hafen",
    group: "Wege",
    cost: cost(12, { stones: 6 }),
    w: 3,
    h: 2,
    work: 10,
    limit: "many",
    about: "Ein Steg auf einer steinernen Mole, wo Schiffe anlegen.",
  },
  schiff: {
    name: "Schiff",
    group: "Wege",
    cost: cost(12),
    w: 2,
    h: 1,
    work: 8,
    limit: "many",
    about:
      "Liegt an einem Hafen und fährt die Waldleute zu den anderen Häfen am See.",
  },
  damm: {
    name: "Damm",
    group: "Prestige",
    cost: cost(30, { stones: 80 }),
    w: 7,
    h: 2,
    work: 40,
    limit: "one",
    about: "Staut die Sihl zum Sihlsee. Was im Becken steht, geht unter.",
  },
};

export const groups: Group[] = [
  "Wohnen",
  "Wirtschaft",
  "Wege",
  "Spiele",
  "Prestige",
];

/** The buildings Waldleute are put in to work: they break stones or print books. */
export const crewKinds: Kind[] = ["steinbruch", "druckerei"];

/** The buildings that bring a raven: Meinrad kept two. */
export const ravenKinds: Kind[] = ["klause", "kloster"];

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
