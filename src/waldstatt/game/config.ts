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
  /** Seconds for the printing press to turn one parchment into one print. */
  printSeconds: 8,
  /** Stock limits. */
  maxParchment: 30,
  maxPrints: 20,
  /** Scroll strips: characters of text per tile row, and the minimum rows. */
  scrollCharsPerRow: 110,
  scrollMinRows: 2,
  /** Rows of the scroll's head, which must be cleared before it is laid. */
  scrollHeadRows: 2,
  /** Share of the wood returned when a building is torn down. */
  refund: 0.5,
  /** Trees the saw marks at most in one stroke. */
  sawMaxTiles: 600,
} as const;

export type Kind =
  | "huette"
  | "schafweide"
  | "druckerei"
  | "ortstafel"
  | "chronik"
  | "spielidee"
  | "anleitung"
  | "spielhaus"
  | "theater"
  | "kloster"
  | "damm";

export type Group = "Wohnen" | "Wirtschaft" | "Wissen" | "Spiele" | "Prestige";

export interface Cost {
  wood: number;
  parchment: number;
  prints: number;
}

export interface KindInfo {
  name: string;
  group: Group;
  cost: Cost;
  /** Footprint in tiles; a scroll's height follows its text. */
  w: number;
  h: number;
  /** Seconds of work for one Waldmensch. */
  work: number;
  /** "one": a single one; "game": one per game; "many": any number. */
  limit: "one" | "game" | "many";
  /** The text a visitor can read once it is built. */
  text?: "ortstafel" | "chronik" | "idea" | "controls";
  /** A scroll unrolls into the forest; each section of its text is a strip. */
  scroll?: boolean;
  /** One short line for the build menu. */
  about: string;
}

const cost = (wood: number, parchment = 0, prints = 0): Cost => ({
  wood,
  parchment,
  prints,
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
    about: "Schafe geben Pergament für Schriftrollen.",
  },
  druckerei: {
    name: "Druckerei",
    group: "Wirtschaft",
    cost: cost(20, 4),
    w: 3,
    h: 3,
    work: 14,
    limit: "one",
    about: "Druckt Pergament zu Drucken für Anleitungen.",
  },
  ortstafel: {
    name: "Ortstafel",
    group: "Wissen",
    cost: cost(3),
    w: 1,
    h: 1,
    work: 3,
    limit: "one",
    text: "ortstafel",
    about: "Woher der Name kommt.",
  },
  chronik: {
    name: "Chronik",
    group: "Wissen",
    cost: cost(4, 4),
    w: 6,
    h: 0,
    work: 8,
    limit: "one",
    text: "chronik",
    scroll: true,
    about: "Eine Schriftrolle: wer wir sind und wie wir arbeiten.",
  },
  spielidee: {
    name: "Spielidee",
    group: "Wissen",
    cost: cost(3, 3),
    w: 5,
    h: 0,
    work: 8,
    limit: "game",
    text: "idea",
    scroll: true,
    about: "Eine Schriftrolle: die Idee des Spiels und was dich erwartet.",
  },
  anleitung: {
    name: "Anleitung",
    group: "Wissen",
    cost: cost(4, 0, 2),
    w: 2,
    h: 1,
    work: 5,
    limit: "game",
    text: "controls",
    about: "Ein gedruckter Anschlag mit der Steuerung.",
  },
  spielhaus: {
    name: "Spielhaus",
    group: "Spiele",
    cost: cost(12),
    w: 3,
    h: 3,
    work: 10,
    limit: "game",
    about: "Hier wohnt das Spiel: spielen und Quellcode.",
  },
  theater: {
    name: "Theater",
    group: "Spiele",
    cost: cost(40),
    w: 5,
    h: 4,
    work: 24,
    limit: "one",
    about: "Vorstellungen der Spiele, deren Spielhaus steht.",
  },
  kloster: {
    name: "Kloster Einsiedeln",
    group: "Prestige",
    cost: cost(150, 10, 6),
    w: 9,
    h: 7,
    work: 90,
    limit: "one",
    about: "Der grösste Bau der Waldstatt. Nur zum Bewundern.",
  },
  damm: {
    name: "Damm",
    group: "Prestige",
    cost: cost(60),
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
  "Wissen",
  "Spiele",
  "Prestige",
];

/** The heading of the controls section in the games' Markdown. */
export const controlsHeading = "Steuerung";
