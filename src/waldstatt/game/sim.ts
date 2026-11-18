/**
 * The game's rules: Waldleute fell marked trees, build building sites, pave,
 * work in the producing buildings and walk back to eat. The site's texts lie
 * hidden under the forest and are found by felling it; the axe and the saw
 * lie on the ground to be picked up, and ravens show the way to the games'
 * scrolls. Waldleute walk only on open ground (nav.ts): they fell their way
 * into the forest from its edge, cross rivers on bridges and the dam, and
 * cross a lake by ship between its ports. Felled wood counts at once. The
 * goods, the people's lives, motivation, the forest growing back and the
 * flood are systems of their own (economy.ts, people.ts, mood.ts, growth.ts,
 * flood.ts), stepped here in turn. No rendering and no DOM here.
 */
import {
  balance,
  CHUNK,
  crewKinds,
  goodKeys,
  kinds,
  placing,
  ravenKinds,
  texts,
  type Cost,
  type Kind,
  type KindInfo,
  type TextKind,
} from "./config";
import { Economy } from "./economy";
import { Flood } from "./flood";
import { Growth } from "./growth";
import { Mood } from "./mood";
import { fire, lifespan, People, placeFire } from "./people";
import {
  clearLine,
  search,
  straighten,
  tileId,
  tileX,
  tileY,
  waterRoute,
  type Ferry,
  type Point,
} from "./nav";
import type { Building, Person, Saved } from "./state";
import {
  damSite,
  hasBaseTree,
  isAbroad,
  isKnown,
  isLakeBasin,
  isNaturalLake,
  isRiver,
  isWall,
  lakeAt,
  start,
  town,
} from "./world";

/** A point to walk to, or a crossing by ship that ends at (x, y). */
export interface Step extends Point {
  sail?: { from: number; to: number };
}

/** A Waldmensch: the saved person, and what they are doing now. */
export interface Worker extends Person {
  /** "wait": at a quay for a ship; "sail": on board. */
  phase: "idle" | "walk" | "wait" | "sail" | "work";
  task?:
    | { type: "fell"; x: number; y: number }
    | { type: "build"; id: number }
    | { type: "pave"; x: number; y: number }
    | { type: "workshop"; id: number }
    | { type: "eat" };
  /** The way still ahead. */
  route: Step[];
  /** The ways as they were when the route was found (Game.ways). */
  ways: number;
  /** Seconds in the current phase. */
  t: number;
  facing: 1 | -1;
}

/** A text hidden under the forest: found with its first felled tree. */
export interface HiddenText {
  /** "ortstafel", "chronik" or "game:<id>". */
  key: string;
  kind: TextKind;
  game?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tiles of it without a tree. */
  cleared: number;
}

/** What a text needs to be placed: its key and size in tiles. */
export interface TextSpec {
  key: string;
  kind: TextKind;
  game?: string;
  w: number;
  h: number;
}

export const isFound = (t: HiddenText) => t.cleared > 0;
export const isExplored = (t: HiddenText) => t.cleared >= t.w * t.h;

/** One of Meinrad's ravens, showing the way to a game's scroll. */
export interface Raven {
  /** The building it came with. */
  id: number;
  x: number;
  y: number;
  /** Where it circles, and the text it leads to, if any. */
  goal: Point;
  target?: string;
  /** Its angle round the goal, and its heading for the picture. */
  orbit: number;
  facing: 1 | -1;
}

/** A finished ship, docked at its port or under way. */
export interface Ship {
  /** The Schiff building. */
  id: number;
  lake: number;
  home: Point;
  x: number;
  y: number;
  /** The hull points along x or along y. */
  axis: "x" | "y";
  route: Point[];
  job?: { from: number; to: number; phase: "fetch" | "carry" | "home" };
  passengers: Worker[];
}

interface Port {
  id: number;
  lake: number;
  /** The land tile where Waldleute board, and the water before it. */
  quay: Point;
  dock: Point;
}

export interface Events {
  /** A tree was felled, marked or unmarked. */
  tree(x: number, y: number): void;
  /** A building was added, changed or removed. */
  building(b: Building, removed?: boolean): void;
  supplies(): void;
  /** A hidden text was found, or more of it lies free. */
  text(t: HiddenText, found: boolean): void;
  /** A tile was cobbled, or planned for cobbles or no longer. */
  paving(x: number, y: number): void;
  /** The axe or the saw appeared or was picked up. */
  items(): void;
  /** A raven took up a new text to lead to, or came. */
  raven(r: Raven, text: HiddenText | undefined): void;
  /** The Sihlsee rose or fell, or the flood wave moved on. */
  flood(): void;
  /** A tombstone was laid. */
  tomb(x: number, y: number): void;
  /** A good was had for the first time. */
  goods(): void;
  /** Something appeared in the build menu. */
  unlocked(): void;
  /** Something happened worth telling. */
  news(text: string): void;
  /** Something worth saving changed. */
  dirty(): void;
}

export interface Placement {
  ok: boolean;
  reason?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per tile, row by row: free, a tree to fell, or blocked. */
  tiles: ("free" | "tree" | "blocked")[];
}

export const key = (x: number, y: number) => `${x},${y}`;

function chunkOf(x: number, y: number) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const index = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
  return { chunk: key(cx, cy), index };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A small deterministic random generator in [0, 1). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const directions = [
  "Osten",
  "Südosten",
  "Süden",
  "Südwesten",
  "Westen",
  "Nordwesten",
  "Norden",
  "Nordosten",
];

/** The compass direction from one point to another; north is −y. */
export function compass(from: Point, to: Point): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return directions[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

const neighbours: [number, number][] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export class Game {
  readonly ships = new Map<number, Ship>();
  readonly economy: Economy;
  readonly people: People;
  readonly mood: Mood;
  readonly growth: Growth;
  readonly flood: Flood;
  /** Footprint tiles of every building, site and ruin, by tile id. */
  private occupancy = new Map<number, Building>();
  /** Tiles with a tombstone. */
  private tombs = new Set<number>();
  /** The marked trees, by tile id. */
  private marked = new Set<number>();
  /** Trees a Waldmensch is on the way to fell. */
  private claimed = new Set<number>();
  /** Tiles planned for cobbles, and those a Waldmensch is on the way to pave. */
  private paveSet = new Set<number>();
  private paveClaimed = new Set<number>();
  /** Whether a tile is open ground, as far as asked. */
  private openCache = new Map<number, boolean>();
  private portCache: Map<number, Port> | null = null;
  private ferryCache: Map<number, Ferry[]> | null = null;
  /** Counts the times a way closed: a bridge, port or ship went, or the flood. */
  private ways = 0;
  /** Counts the changes that may bring new work within reach. */
  private chances = 0;
  /** Searches left in this step, so many Waldleute do not search at once. */
  private searches = 0;
  /** The tiles from which searches found no work, until a change. */
  private noWork: { chances: number; tiles: Set<number> } | null = null;
  /** The hidden texts, and their tiles by tile id. */
  readonly hidden: HiddenText[] = [];
  private textTiles = new Map<number, HiddenText>();
  readonly ravens: Raven[] = [];
  private ravenClock = 0;
  /** Trees felled so far, and the last one, for the saw. */
  private felledCount = 0;
  private lastFelled: Point | null = null;

  constructor(
    readonly state: Saved,
    readonly gameIds: string[],
    /** The texts to hide in the forest, with their sizes. */
    specs: TextSpec[],
    readonly events: Events,
  ) {
    placeFire();
    for (const p of state.people) this.decorate(p);
    for (const t of state.tombs) this.tombs.add(tileId(t.x, t.y));
    for (const bits of state.felled.values())
      for (const byte of bits) {
        let b = byte;
        while (b) {
          b &= b - 1;
          this.felledCount++;
        }
      }
    for (const k of state.marks) {
      const [x, y] = k.split(",").map(Number);
      this.marked.add(tileId(x, y));
    }
    for (const k of state.paving) {
      const [x, y] = k.split(",").map(Number);
      this.paveSet.add(tileId(x, y));
    }
    for (const b of state.buildings) this.occupy(b);
    this.economy = new Economy(this);
    this.mood = new Mood(this);
    this.flood = new Flood(this);
    this.growth = new Growth(this);
    this.people = new People(this);
    this.hideTexts(specs);
    this.economy.syncCrews();
    this.syncRavens();
    this.syncShips();
    this.checkUnlocks(true);
  }

  /** The Waldleute: the saved people, with what they are doing now. */
  get workers(): Worker[] {
    return this.state.people as Worker[];
  }

  private decorate(p: Person): Worker {
    return Object.assign(p, {
      phase: "idle",
      route: [],
      ways: this.ways,
      t: 0,
      facing: 1,
    } satisfies Partial<Worker>) as Worker;
  }

  /** A new Waldmensch, at the start or born. */
  addPerson(o: { sex: "f" | "m"; age: number; x: number; y: number }): Worker {
    const p: Person = {
      id: this.state.nextPerson++,
      sex: o.sex,
      age: o.age,
      life: lifespan(),
      hunger: 0,
      lastChild: -1,
      x: o.x,
      y: o.y,
    };
    this.state.people.push(p);
    return this.decorate(p);
  }

  /** A Waldmensch died: off the map, the ship and the crew. */
  removePerson(w: Worker) {
    this.idle(w);
    this.state.people = this.state.people.filter((p) => p !== w);
    for (const s of this.ships.values())
      s.passengers = s.passengers.filter((p) => p !== w);
  }

  /** Lays a tombstone on a tile, or the nearest free one. */
  addTomb(x: number, y: number) {
    for (let r = 0; r < 4; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          const id = tileId(tx, ty);
          if (
            this.tombs.has(id) ||
            this.occupancy.has(id) ||
            this.isWater(tx, ty) ||
            this.isTree(tx, ty)
          )
            continue;
          this.tombs.add(id);
          this.state.tombs.push({ x: tx, y: ty });
          this.growth.clear(tx, ty);
          this.events.tomb(tx, ty);
          return;
        }
  }

  hasTomb(x: number, y: number): boolean {
    return this.tombs.has(tileId(x, y));
  }

  /** Something changed that may bring new work within reach. */
  opened() {
    this.chances++;
  }

  info(b: Pick<Building, "kind">): KindInfo {
    return kinds[b.kind];
  }

  /** A building's name, with its game's title if it has one. */
  nameOf(b: Pick<Building, "kind" | "game">): string {
    return b.game
      ? `${kinds[b.kind].name} ${this.titleOf(b.game)}`
      : kinds[b.kind].name;
  }

  /** A game's title, set by the page. */
  titleOf: (game: string) => string = (game) => game;

  // --- The forest -------------------------------------------------------

  isPaved(x: number, y: number): boolean {
    const { chunk, index } = chunkOf(x, y);
    const bits = this.state.paved.get(chunk);
    return !!bits && (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  isPlannedPaving(x: number, y: number): boolean {
    return this.paveSet.has(tileId(x, y));
  }

  /** Whether cobbles can go here: cleared, dry, inside, and not built on. */
  canPave(x: number, y: number): boolean {
    return (
      isKnown(x, y) &&
      !this.isTree(x, y) &&
      !this.isWater(x, y) &&
      !isWall(x, y) &&
      !isAbroad(x, y) &&
      !this.occupancy.has(tileId(x, y)) &&
      !this.tombs.has(tileId(x, y)) &&
      !this.isPaved(x, y)
    );
  }

  /** Plans or unplans cobbles on one tile. */
  togglePaving(x: number, y: number): "planned" | "unplanned" | "none" {
    const id = tileId(x, y);
    if (this.paveSet.has(id)) {
      this.paveSet.delete(id);
      this.state.paving.delete(key(x, y));
      this.events.paving(x, y);
      this.events.dirty();
      return "unplanned";
    }
    if (!this.canPave(x, y)) return "none";
    this.planPaving(x, y);
    this.events.dirty();
    return "planned";
  }

  private planPaving(x: number, y: number) {
    this.paveSet.add(tileId(x, y));
    this.state.paving.add(key(x, y));
    this.chances++;
    this.events.paving(x, y);
  }

  /** Plans cobbles on every free tile of a rectangle; returns how many. */
  paveArea(x0: number, y0: number, x1: number, y1: number): number {
    let count = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (count >= balance.paveMaxTiles) break;
        if (this.paveSet.has(tileId(x, y)) || !this.canPave(x, y)) continue;
        this.planPaving(x, y);
        count++;
      }
    if (count) this.events.dirty();
    return count;
  }

  /** Lays one stone: the tile is cobbled. */
  private layStone(x: number, y: number) {
    const id = tileId(x, y);
    this.paveClaimed.delete(id);
    if (!this.paveSet.has(id) || this.state.stock.stones < 1) return;
    this.paveSet.delete(id);
    this.state.paving.delete(key(x, y));
    if (!this.canPave(x, y)) return this.events.paving(x, y);
    this.state.stock.stones--;
    const { chunk, index } = chunkOf(x, y);
    let bits = this.state.paved.get(chunk);
    if (!bits) {
      bits = new Uint8Array((CHUNK * CHUNK) / 8);
      this.state.paved.set(chunk, bits);
    }
    bits[index >> 3] |= 1 << (index & 7);
    this.state.dirtyChunks.add(chunk);
    this.growth.clear(x, y);
    this.events.paving(x, y);
    this.events.supplies();
    this.events.dirty();
  }

  // --- Crews --------------------------------------------------------------

  /** How many Waldleute work in a producing building now. */
  crewOf(b: Building): number {
    return this.economy.crewOf(b);
  }

  /** Puts Waldleute into a producing building, or takes them out. */
  setCrew(b: Building, crew: number) {
    if (!crewKinds.includes(b.kind) || b.state !== "done") return;
    b.crew = clamp(crew, 0, balance.maxCrew);
    this.economy.syncCrews();
    this.events.building(b);
    this.events.dirty();
  }

  isFelled(x: number, y: number): boolean {
    const { chunk, index } = chunkOf(x, y);
    const bits = this.state.felled.get(chunk);
    return !!bits && (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  private setFelled(x: number, y: number) {
    const { chunk, index } = chunkOf(x, y);
    let bits = this.state.felled.get(chunk);
    if (!bits) {
      bits = new Uint8Array((CHUNK * CHUNK) / 8);
      this.state.felled.set(chunk, bits);
    }
    bits[index >> 3] |= 1 << (index & 7);
    this.state.dirtyChunks.add(chunk);
  }

  /** The Sihlsee rose over a tile: its tree dies, its marks go. */
  drown(x: number, y: number) {
    if (this.isTree(x, y) || hasBaseTree(x, y)) this.setFelled(x, y);
    this.growth.clear(x, y);
    if (this.unmark(x, y)) this.claimed.delete(tileId(x, y));
    this.openCache.delete(tileId(x, y));
  }

  /** Whether a seedling may grow on felled ground. */
  canGrow(x: number, y: number): boolean {
    const id = tileId(x, y);
    return (
      !this.occupancy.has(id) &&
      !this.tombs.has(id) &&
      !this.isPaved(x, y) &&
      !this.paveSet.has(id) &&
      !this.isWater(x, y) &&
      Math.hypot(x + 0.5 - fire.x, y + 0.5 - fire.y) > 2
    );
  }

  /** Whether a Waldmensch stands on a tile. */
  someoneOn(x: number, y: number): boolean {
    return this.workers.some(
      (w) => Math.floor(w.x) === x && Math.floor(w.y) === y,
    );
  }

  /** A seedling grew into a tree: the tile is forest again. */
  regrow(x: number, y: number) {
    const { chunk, index } = chunkOf(x, y);
    const bits = this.state.felled.get(chunk);
    if (!bits) return;
    bits[index >> 3] &= ~(1 << (index & 7));
    this.state.dirtyChunks.add(chunk);
    this.felledCount--;
    this.openCache.delete(tileId(x, y));
    this.chances++;
    this.events.tree(x, y);
    const t = this.textAt(x, y);
    if (t) {
      t.cleared--;
      this.events.text(t, false);
    }
  }

  /** How far a seedling on a tile has grown, 0 to 1; 0 if none. */
  seedling(x: number, y: number): number {
    return this.growth.stage(x, y);
  }

  isLake(x: number, y: number): boolean {
    return this.flood.flooded(x, y);
  }

  isWater(x: number, y: number): boolean {
    return isRiver(x, y) || this.flood.flooded(x, y) || this.flood.waved(x, y);
  }

  /** Which lake's water a tile is, natural or the dammed Sihlsee; 0 for none. */
  lakeAt(x: number, y: number): number {
    return lakeAt(x, y, this.flood.flooded(x, y));
  }

  private lakeOf(x: number, y: number): number {
    return this.lakeAt(x, y);
  }

  /** A page of water arrived: ways and work there are new. */
  pagesChanged() {
    this.waysChanged(false);
    this.syncShips();
  }

  isTree(x: number, y: number): boolean {
    return (
      // Hidden texts lie under unbroken forest.
      (hasBaseTree(x, y) || this.textTiles.has(tileId(x, y))) &&
      !this.isFelled(x, y) &&
      !this.flood.flooded(x, y)
    );
  }

  isMarked(x: number, y: number): boolean {
    return this.marked.has(tileId(x, y));
  }

  buildingAt(x: number, y: number): Building | undefined {
    return this.occupancy.get(tileId(x, y));
  }

  private mark(x: number, y: number) {
    this.state.marks.add(key(x, y));
    this.marked.add(tileId(x, y));
    this.chances++;
  }

  private unmark(x: number, y: number): boolean {
    this.marked.delete(tileId(x, y));
    return this.state.marks.delete(key(x, y));
  }

  /** Marks or unmarks one tree. */
  toggleMark(x: number, y: number): "marked" | "unmarked" | "none" {
    if (!this.isTree(x, y) || !isKnown(x, y)) return "none";
    const marked = this.isMarked(x, y);
    if (marked) this.unmark(x, y);
    else this.mark(x, y);
    this.events.tree(x, y);
    this.events.dirty();
    return marked ? "unmarked" : "marked";
  }

  /** Marks every tree in a rectangle; returns how many were newly marked. */
  markArea(x0: number, y0: number, x1: number, y1: number): number {
    let count = 0;
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        if (count >= balance.sawMaxTiles) break;
        if (this.isTree(x, y) && !this.isMarked(x, y) && isKnown(x, y)) {
          this.mark(x, y);
          this.events.tree(x, y);
          count++;
        }
      }
    }
    if (count) this.events.dirty();
    return count;
  }

  // --- Hidden texts and the tools on the ground ----------------------------

  /** The hidden text lying on a tile, if any. */
  textAt(x: number, y: number): HiddenText | undefined {
    return this.textTiles.get(tileId(x, y));
  }

  text(key: string): HiddenText | undefined {
    return this.hidden.find((t) => t.key === key);
  }

  /** Whether the game's scroll once lay wholly free of trees. */
  explored(game: string): boolean {
    const t = this.text(`game:${game}`);
    return this.state.explored.has(`game:${game}`) || (!!t && isExplored(t));
  }

  /**
   * Lays each text where this forest's seed puts it: the Ortstafel and the
   * Chronik within 1 km of the Klosterplatz, the games' scrolls 1.5 to 5 km
   * out, on dry land outside the Sihlsee's basin and clear of each other and
   * the first clearing. Positions are saved; sizes follow the current text.
   */
  private hideTexts(specs: TextSpec[]) {
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const place = (spec: TextSpec, at: { x: number; y: number }) => {
      const t: HiddenText = { ...spec, ...at, cleared: 0 };
      for (let y = t.y; y < t.y + t.h; y++)
        for (let x = t.x; x < t.x + t.w; x++) {
          this.textTiles.set(tileId(x, y), t);
          if (!this.isTree(x, y)) t.cleared++;
        }
      this.hidden.push(t);
      taken.push(t);
    };
    const fresh: TextSpec[] = [];
    for (const spec of specs) {
      const saved = this.state.texts.get(spec.key);
      if (saved) place(spec, saved);
      else fresh.push(spec);
    }
    const gap = placing.gap;
    const free = (x: number, y: number, w: number, h: number) => {
      for (const o of taken)
        if (
          x - gap < o.x + o.w &&
          o.x - gap < x + w &&
          y - gap < o.y + o.h &&
          o.y - gap < y + h
        )
          return false;
      const sx = clamp(start.x + 0.5, x, x + w);
      const sy = clamp(start.y + 0.5, y, y + h);
      if (Math.hypot(sx - start.x - 0.5, sy - start.y - 0.5) < 3 + gap)
        return false;
      for (let ty = y - 1; ty <= y + h; ty++)
        for (let tx = x - 1; tx <= x + w; tx++)
          if (
            isRiver(tx, ty) ||
            isNaturalLake(tx, ty) ||
            isWall(tx, ty) ||
            isAbroad(tx, ty) ||
            isLakeBasin(tx, ty) ||
            this.occupancy.has(tileId(tx, ty)) ||
            this.isFelled(tx, ty)
          )
            return false;
      return true;
    };
    for (const spec of fresh) {
      const range = placing[texts[spec.kind].where];
      // Each text has its own sequence, so adding a game moves no other text.
      let seed = this.state.seed;
      for (const c of spec.key)
        seed = Math.imul(seed ^ c.charCodeAt(0), 0x9e3779b1);
      const rnd = random(seed);
      let at: { x: number; y: number } | null = null;
      for (let attempt = 0; attempt < 4000 && !at; attempt++) {
        // Wider rings as attempts fail, so a text always finds a place.
        const grow = Math.floor(attempt / 1000) * 10;
        const angle = rnd() * Math.PI * 2;
        const r = Math.sqrt(
          range.min ** 2 + rnd() * ((range.max + grow) ** 2 - range.min ** 2),
        );
        const x = Math.round(town.x + Math.cos(angle) * r - spec.w / 2);
        const y = Math.round(town.y + Math.sin(angle) * r - spec.h / 2);
        if (free(x, y, spec.w, spec.h)) at = { x, y };
      }
      if (!at) continue;
      this.state.texts.set(spec.key, at);
      place(spec, at);
      this.events.dirty();
    }
  }

  /** The item lying on or right beside a tile, if any. */
  itemNear(x: number, y: number): "axe" | "saw" | undefined {
    const near = (p: Point) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1;
    if (!this.state.tools.axe && near(this.axeAt())) return "axe";
    const saw = this.state.sawAt;
    if (saw && !this.state.tools.saw && near(saw)) return "saw";
    return undefined;
  }

  /** Where the axe lies: in the first clearing, beside the Waldmensch. */
  axeAt(): Point {
    return { x: start.x - 1, y: start.y };
  }

  /** Picks up an item lying on or beside a tile. */
  pickUp(x: number, y: number): "axe" | "saw" | undefined {
    const item = this.itemNear(x, y);
    if (!item) return undefined;
    this.state.tools[item] = true;
    if (item === "saw") this.state.sawAt = null;
    this.events.items();
    this.events.dirty();
    return item;
  }

  /** Lays the saw down once a hut stands and enough trees have fallen. */
  private checkSaw() {
    const s = this.state;
    if (s.tools.saw || s.sawAt || this.felledCount < balance.sawAfterTrees)
      return;
    if (!this.done("huette")) return;
    const at = this.lastFelled ?? fire;
    s.sawAt = { x: Math.floor(at.x), y: Math.floor(at.y) };
    this.events.items();
    this.events.dirty();
  }

  // --- Ways -------------------------------------------------------------

  /** Whether Waldleute can walk on a tile: no tree, and no water unless bridged. */
  open(x: number, y: number): boolean {
    const id = tileId(x, y);
    let open = this.openCache.get(id);
    if (open === undefined) {
      const b = this.occupancy.get(id);
      const crossing =
        b?.state === "done" && (b.kind === "bruecke" || b.kind === "damm");
      open =
        !this.isTree(x, y) &&
        !isWall(x, y) &&
        !isAbroad(x, y) &&
        (crossing || !this.isWater(x, y));
      if (this.openCache.size > 250_000) this.openCache.clear();
      this.openCache.set(id, open);
    }
    return open;
  }

  /** Forgets what it knew about ways; `closed` if a way may have gone. */
  waysChanged(closed: boolean) {
    this.chances++;
    this.openCache.clear();
    this.portCache = null;
    this.ferryCache = null;
    if (closed) this.ways++;
  }

  /** The finished ports, each with its quay and the water before it. */
  private ports(): Map<number, Port> {
    if (this.portCache) return this.portCache;
    const ports = new Map<number, Port>();
    for (const b of this.state.buildings) {
      if (b.kind !== "hafen" || b.state !== "done") continue;
      let best: (Port & { d: number }) | undefined;
      for (let y = b.y - 1; y <= b.y + b.h; y++) {
        for (let x = b.x - 1; x <= b.x + b.w; x++) {
          const outX = x < b.x || x >= b.x + b.w;
          const outY = y < b.y || y >= b.y + b.h;
          // Only the water beside the port, not past its corners.
          if (outX === outY) continue;
          const lake = this.lakeOf(x, y);
          if (!lake) continue;
          const d = Math.hypot(
            x + 0.5 - b.x - b.w / 2,
            y + 0.5 - b.y - b.h / 2,
          );
          if (best && best.d <= d) continue;
          const qx = clamp(x, b.x, b.x + b.w - 1);
          const qy = clamp(y, b.y, b.y + b.h - 1);
          best = {
            id: b.id,
            lake,
            quay: { x: qx + 0.5, y: qy + 0.5 },
            dock: { x: x + 0.5, y: y + 0.5 },
            d,
          };
        }
      }
      if (best) ports.set(b.id, best);
    }
    this.portCache = ports;
    return ports;
  }

  /** The crossings by ship: between the ports of every lake that has a ship. */
  private ferries(): Map<number, Ferry[]> {
    if (this.ferryCache) return this.ferryCache;
    const served = new Set([...this.ships.values()].map((s) => s.lake));
    const ferries = new Map<number, Ferry[]>();
    const ports = [...this.ports().values()].filter((p) => served.has(p.lake));
    for (const a of ports) {
      for (const b of ports) {
        if (a === b || a.lake !== b.lake) continue;
        const from = tileId(Math.floor(a.quay.x), Math.floor(a.quay.y));
        const list = ferries.get(from) ?? [];
        list.push({
          to: tileId(Math.floor(b.quay.x), Math.floor(b.quay.y)),
          x: b.quay.x,
          y: b.quay.y,
          cost:
            (Math.hypot(b.dock.x - a.dock.x, b.dock.y - a.dock.y) *
              balance.walkSpeed) /
              balance.shipSpeed +
            balance.boardingCost,
          from: a.id,
          port: b.id,
        });
        ferries.set(from, list);
      }
    }
    this.ferryCache = ferries;
    return ferries;
  }

  /** For a finished port: how many ports and ships share its lake. */
  harbour(b: Building): { ports: number; ships: number } {
    const port = this.ports().get(b.id);
    if (!port) return { ports: 0, ships: 0 };
    const same = <T extends { lake: number }>(list: Iterable<T>) =>
      [...list].filter((other) => other.lake === port.lake).length;
    return {
      ports: same(this.ports().values()),
      ships: same(this.ships.values()),
    };
  }

  /** The axis a bridge spans along: x or y. */
  bridgeAxis(b: Pick<Building, "x" | "y" | "w" | "h">): "x" | "y" {
    if (b.w !== b.h) return b.w > b.h ? "x" : "y";
    return !this.isWater(b.x - 1, b.y) && !this.isWater(b.x + 1, b.y)
      ? "x"
      : "y";
  }

  /** The shortest run of river across (x, y), bank to bank, or why not. */
  private bridgeSpan(
    x: number,
    y: number,
  ): { x: number; y: number; w: number; h: number } | { reason: string } {
    const lakeReason =
      "Über einen See führt keine Brücke. Bau Häfen und ein Schiff.";
    if (this.lakeAt(x, y)) return { reason: lakeReason };
    if (!this.isWater(x, y))
      return { reason: "Eine Brücke gehört über einen Fluss." };
    const max = balance.bridgeMaxSpan;
    const run = (dx: number, dy: number) => {
      let back = 0;
      let ahead = 0;
      while (
        back <= max &&
        this.isWater(x - dx * (back + 1), y - dy * (back + 1))
      )
        back++;
      while (
        ahead <= max &&
        this.isWater(x + dx * (ahead + 1), y + dy * (ahead + 1))
      )
        ahead++;
      return dx
        ? { x: x - back, y, w: back + ahead + 1, h: 1 }
        : { x, y: y - back, w: 1, h: back + ahead + 1 };
    };
    const across = run(1, 0);
    const along = run(0, 1);
    const span = across.w <= along.h ? across : along;
    if (Math.max(span.w, span.h) > max)
      return { reason: "Hier ist der Fluss zu breit für eine Brücke." };
    for (let ty = span.y; ty < span.y + span.h; ty++)
      for (let tx = span.x; tx < span.x + span.w; tx++)
        if (this.lakeAt(tx, ty)) return { reason: lakeReason };
    return span;
  }

  /** Whether any tile beside a footprint (not past its corners) passes a test. */
  private beside(
    x: number,
    y: number,
    w: number,
    h: number,
    test: (x: number, y: number) => boolean,
  ): boolean {
    for (let tx = x; tx < x + w; tx++)
      if (test(tx, y - 1) || test(tx, y + h)) return true;
    for (let ty = y; ty < y + h; ty++)
      if (test(x - 1, ty) || test(x + w, ty)) return true;
    return false;
  }

  // --- Buildings --------------------------------------------------------

  standing(kind: Kind, game?: string): Building | undefined {
    return this.state.buildings.find(
      (b) =>
        b.kind === kind &&
        b.state !== "drowned" &&
        (game === undefined || b.game === game),
    );
  }

  done(kind: Kind, game?: string): boolean {
    return this.state.buildings.some(
      (b) =>
        b.kind === kind &&
        b.state === "done" &&
        (game === undefined || b.game === game),
    );
  }

  size(kind: Kind): { w: number; h: number } {
    return { w: kinds[kind].w, h: kinds[kind].h };
  }

  /** Whether two footprints touch, side by side or at a corner. */
  touching(
    a: Pick<Building, "x" | "y" | "w" | "h">,
    b: Pick<Building, "x" | "y" | "w" | "h">,
  ): boolean {
    return (
      a.x <= b.x + b.w &&
      b.x <= a.x + a.w &&
      a.y <= b.y + b.h &&
      b.y <= a.y + a.h
    );
  }

  /** Whether a building's condition to appear in the build menu is met. */
  private meets(kind: Kind): boolean {
    if (kind === "damm") return this.damSiteClear();
    const a = kinds[kind].appears;
    if (!a) return true;
    if (a.people && this.workers.length < a.people) return false;
    if (a.all && !a.all.every((k) => this.done(k))) return false;
    if (a.any && !a.any.some((k) => this.done(k))) return false;
    return true;
  }

  /** Whether every tree on the dam's site is felled. */
  private damSiteClear(): boolean {
    for (let y = damSite.y; y < damSite.y + damSite.h; y++)
      for (let x = damSite.x; x < damSite.x + damSite.w; x++)
        if (!isKnown(x, y) || this.isTree(x, y)) return false;
    return true;
  }

  /** Records what newly appears in the build menu; it stays from then on. */
  checkUnlocks(quiet = false) {
    let added = false;
    for (const kind of Object.keys(kinds) as Kind[]) {
      if (this.state.unlocked.has(kind) || !this.meets(kind)) continue;
      this.state.unlocked.add(kind);
      // What is there from the start is not news.
      if (!quiet && (kinds[kind].appears || kind === "damm")) added = true;
    }
    if (!added) return;
    this.state.fresh = true;
    this.events.unlocked();
    this.events.dirty();
  }

  /** Whether the build menu shows a building. */
  shown(kind: Kind, game?: string): boolean {
    if (!this.state.unlocked.has(kind)) return false;
    if (kind === "spielhaus") return !!game && this.explored(game);
    if (kind === "bibliothek") return !!game && this.done("spielhaus", game);
    return true;
  }

  /** Why a building cannot be chosen now, or undefined if it can. */
  unavailable(kind: Kind, game?: string): string | undefined {
    const info = kinds[kind];
    if (!this.shown(kind, game)) return "Das gibt es noch nicht.";
    if (info.limit !== "many") {
      const existing = this.standing(
        kind,
        info.limit === "game" ? game : undefined,
      );
      if (existing)
        return existing.state === "site"
          ? "Ist schon im Bau."
          : existing.state === "ruin"
            ? "Steht als Ruine."
            : "Steht schon.";
    }
    if (kind === "schiff" && !this.done("hafen"))
      return "Braucht einen fertigen Hafen.";
    const missing = this.economy.missing(info.cost);
    if (missing) return `Es fehlen ${missing}.`;
    return undefined;
  }

  /**
   * Checks a footprint whose top-left tile is (x, y). The dam has its fixed
   * site; a bridge spans the river from the tile (x, y) to both banks.
   */
  placement(kind: Kind, x: number, y: number): Placement {
    let { w, h } = this.size(kind);
    if (kind === "damm") ({ x, y } = damSite);
    if (kind === "bruecke") {
      const span = this.bridgeSpan(x, y);
      if ("reason" in span)
        return {
          ok: false,
          reason: span.reason,
          x,
          y,
          w,
          h,
          tiles: ["blocked"],
        };
      ({ x, y, w, h } = span);
    }
    const tiles: Placement["tiles"] = [];
    let reason: string | undefined;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        let tile: Placement["tiles"][number] = "free";
        if (this.occupancy.has(tileId(tx, ty))) {
          tile = "blocked";
          reason ??= "Da steht schon etwas.";
        } else if (isWall(tx, ty) || isAbroad(tx, ty)) {
          tile = "blocked";
          reason ??= "Hier endet die Schweiz.";
        } else if (this.textTiles.has(tileId(tx, ty))) {
          tile = "blocked";
          reason ??= "Hier liegt eine Schrift im Boden.";
        } else if (this.tombs.has(tileId(tx, ty))) {
          tile = "blocked";
          reason ??= "Hier liegt ein Grab.";
        } else if (kind === "schiff") {
          if (!this.lakeAt(tx, ty)) {
            tile = "blocked";
            reason ??= "Ein Schiff gehört aufs Wasser eines Sees.";
          }
        } else if (kind === "bruecke") {
          // The span was checked above.
        } else if (kind !== "damm" && this.isWater(tx, ty)) {
          tile = "blocked";
          reason ??= "Nicht im Wasser.";
        } else if (this.isTree(tx, ty)) {
          // Buildings stand only on cleared ground.
          tile = "tree";
          reason ??= "Zuerst die Bäume fällen.";
        }
        tiles.push(tile);
      }
    }
    const spot = { x, y, w, h };
    if (!reason) reason = this.siteRule(kind, spot);
    return { ok: !reason, reason, x, y, w, h, tiles };
  }

  /** What a building needs round its site, beyond free ground. */
  private siteRule(
    kind: Kind,
    spot: Pick<Building, "x" | "y" | "w" | "h">,
  ): string | undefined {
    const { x, y, w, h } = spot;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const near = (b: Building) =>
      Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
    if (
      kind === "hafen" &&
      !this.beside(x, y, w, h, (tx, ty) => !!this.lakeAt(tx, ty))
    )
      return "Ein Hafen gehört ans Ufer eines Sees.";
    if (
      kind === "schiff" &&
      !this.beside(x, y, w, h, (tx, ty) => {
        const b = this.buildingAt(tx, ty);
        return b?.kind === "hafen" && b.state === "done";
      })
    )
      return "Ein Schiff legt an einem fertigen Hafen an.";
    if (
      kind === "muehle" &&
      !this.beside(
        x,
        y,
        w,
        h,
        (tx, ty) => isRiver(tx, ty) && !isNaturalLake(tx, ty),
      )
    )
      return "Eine Wassermühle gehört an einen Fluss.";
    if (kind === "ise" && Math.hypot(cx - fire.x, cy - fire.y) > 5)
      return "Die ISE AG steht an der Holzrüti 2, in der ersten Lichtung.";
    if (
      kind === "kirche" &&
      this.state.buildings.some(
        (b) =>
          (b.kind === "kirche" || b.kind === "kloster") &&
          b.state !== "drowned" &&
          near(b) < balance.reach,
      )
    )
      return "Zu nah an einer anderen Kirche oder am Kloster.";
    if (
      kind === "friedhof" &&
      !this.state.buildings.some(
        (b) =>
          (b.kind === "kirche" || b.kind === "kloster") &&
          b.state !== "drowned" &&
          this.touching(b, spot),
      )
    )
      return "Ein Friedhof gehört direkt neben eine Kirche oder das Kloster.";
    return undefined;
  }

  place(
    kind: Kind,
    game: string | undefined,
    x: number,
    y: number,
  ): Building | undefined {
    if (this.unavailable(kind, game)) return undefined;
    const spot = this.placement(kind, x, y);
    if (!spot.ok) return undefined;
    const info = kinds[kind];
    this.economy.pay(info.cost);
    const b: Building = {
      id: this.state.nextId++,
      kind,
      game: info.limit === "game" ? game : undefined,
      x: spot.x,
      y: spot.y,
      w: spot.w,
      h: spot.h,
      state: "site",
      work: 0,
    };
    this.state.buildings.push(b);
    this.occupy(b);
    for (let ty = b.y; ty < b.y + b.h; ty++)
      for (let tx = b.x; tx < b.x + b.w; tx++) this.growth.clear(tx, ty);
    this.waysChanged(false);
    this.events.building(b);
    this.events.dirty();
    return b;
  }

  /** What tearing a building down gives back: half its costs, rounded down. */
  refund(b: Building): Cost {
    if (b.state === "ruin") return {};
    return this.share(kinds[b.kind].cost, balance.refund);
  }

  /** What repairing a ruin takes. */
  repairCost(b: Building): Cost {
    return this.share(kinds[b.kind].cost, balance.repair);
  }

  private share(cost: Cost, k: number): Cost {
    const out: Cost = {};
    for (const key of goodKeys) {
      const n = Math.floor((cost[key] ?? 0) * k);
      if (n > 0) out[key] = n;
    }
    return out;
  }

  canDemolish(b: Building): boolean {
    return b.state !== "drowned";
  }

  /** Tears a building down and gives back part of its costs. */
  demolish(b: Building) {
    if (!this.canDemolish(b)) return;
    const refund = this.refund(b);
    const dam = b.kind === "damm" && b.state === "done";
    this.removeBuilding(b);
    for (const key of goodKeys)
      if (refund[key]) this.economy.gain(key, refund[key] ?? 0);
    if (dam) this.flood.breakDam();
  }

  /** Repairs a ruin: it becomes a building site again. */
  repair(b: Building): string | undefined {
    if (b.state !== "ruin") return undefined;
    const cost = this.repairCost(b);
    const missing = this.economy.missing(cost);
    if (missing) return `Für die Reparatur fehlen ${missing}.`;
    this.economy.pay(cost);
    b.state = "site";
    b.work = 0;
    b.condition = 1;
    this.chances++;
    this.events.building(b);
    this.events.dirty();
    return undefined;
  }

  /** Takes a building off the map, without giving anything back. */
  removeBuilding(b: Building) {
    this.state.buildings = this.state.buildings.filter((other) => other !== b);
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const id = tileId(x, y);
        if (this.occupancy.get(id) === b) this.occupancy.delete(id);
        if (this.unmark(x, y)) this.events.tree(x, y);
      }
    }
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(true);
    this.syncShips();
    this.economy.syncCrews();
    this.syncRavens();
    this.events.building(b, true);
    this.events.supplies();
    this.events.dirty();
  }

  /** A building drowned or fell into ruin: nobody works on or in it any more. */
  lost(b: Building) {
    for (const w of this.workers)
      if (
        (w.task?.type === "build" && w.task.id === b.id) ||
        (w.task?.type === "workshop" && w.task.id === b.id)
      )
        this.idle(w);
    this.waysChanged(true);
    this.syncShips();
    this.economy.syncCrews();
    this.syncRavens();
    this.events.building(b);
    this.events.dirty();
  }

  private occupy(b: Building) {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) this.occupancy.set(tileId(x, y), b);
  }

  progress(b: Building): number {
    return Math.min(1, b.work / kinds[b.kind].work);
  }

  // --- Waldleute and production ------------------------------------------

  idle(w: Worker) {
    // A freed tree or place in a crew is work for somebody else.
    if (w.task) this.chances++;
    if (w.task?.type === "fell")
      this.claimed.delete(tileId(w.task.x, w.task.y));
    if (w.task?.type === "pave")
      this.paveClaimed.delete(tileId(w.task.x, w.task.y));
    w.task = undefined;
    w.route = [];
    // On board, a Waldmensch stays until the ship lands.
    if (w.phase === "sail") return;
    w.phase = "idle";
    w.t = 0;
  }

  /**
   * Looks for the nearest work the Waldmensch can reach: a marked tree beside
   * open ground, or a building site with room in its crew. Sites count as
   * a few tiles nearer, so they come first.
   */
  private findWork(w: Worker): boolean | "later" {
    // Children do not work.
    if (w.age < balance.workingAge) return false;
    const crew = new Map<number, number>();
    for (const other of this.workers)
      if (other.task?.type === "build")
        crew.set(other.task.id, (crew.get(other.task.id) ?? 0) + 1);
    const sites = this.state.buildings.some(
      (b) =>
        b.state === "site" && (crew.get(b.id) ?? 0) < balance.workersPerSite,
    );
    const trees = this.marked.size > this.claimed.size;
    const paves =
      this.paveSet.size > this.paveClaimed.size &&
      this.state.stock.stones > this.paveClaimed.size;
    // A Waldmensch put in a producing building looks only for the way there.
    const workshop = w.job
      ? this.state.buildings.find((b) => b.id === w.job && b.state === "done")
      : undefined;
    if (w.job && !workshop) return false;
    if (!workshop && !sites && !trees && !paves) return false;
    const sx = Math.floor(w.x);
    const sy = Math.floor(w.y);
    // Another Waldmensch just searched here in vain.
    if (
      !workshop &&
      this.noWork?.chances === this.chances &&
      this.noWork.tiles.has(tileId(sx, sy))
    )
      return false;
    type Found =
      | { type: "fell"; x: number; y: number }
      | { type: "build"; b: Building }
      | { type: "pave"; x: number; y: number }
      | { type: "workshop"; b: Building };
    // The tiles on and around the sites that still need hands.
    const siteNear = new Map<number, Building>();
    for (const b of this.state.buildings) {
      if (b.state !== "site" || (crew.get(b.id) ?? 0) >= balance.workersPerSite)
        continue;
      for (let y = b.y - 1; y <= b.y + b.h; y++)
        for (let x = b.x - 1; x <= b.x + b.w; x++)
          if (!siteNear.has(tileId(x, y))) siteNear.set(tileId(x, y), b);
    }
    const goal = (
      x: number,
      y: number,
      open: (x: number, y: number) => boolean,
    ) => {
      if (workshop) {
        const inside =
          x >= workshop.x - 1 &&
          x <= workshop.x + workshop.w &&
          y >= workshop.y - 1 &&
          y <= workshop.y + workshop.h;
        return inside
          ? { bias: -4, value: { type: "workshop", b: workshop } as Found }
          : undefined;
      }
      const b = sites ? siteNear.get(tileId(x, y)) : undefined;
      if (b) return { bias: -4, value: { type: "build", b } as Found };
      const id = tileId(x, y);
      if (paves && this.paveSet.has(id) && !this.paveClaimed.has(id))
        return { bias: 3, value: { type: "pave", x, y } as Found };
      if (trees) {
        for (const [dx, dy] of neighbours) {
          // A marked tree is never open ground.
          if (open(x + dx, y + dy)) continue;
          const id = tileId(x + dx, y + dy);
          if (this.marked.has(id) && !this.claimed.has(id))
            return {
              bias: 6,
              value: { type: "fell", x: x + dx, y: y + dy } as Found,
            };
        }
      }
      return undefined;
    };
    if (this.searches <= 0) return "later";
    this.searches--;
    // Failed searches add up until something changes.
    if (this.noWork?.chances !== this.chances)
      this.noWork = { chances: this.chances, tiles: new Set() };
    const searched = workshop ? new Set<number>() : this.noWork.tiles;
    const found = search(
      {
        open: (x, y) => this.open(x, y),
        ferries: (id) => this.ferries().get(id),
      },
      sx,
      sy,
      goal,
      -4,
      balance.searchTiles,
      searched,
    );
    if (!found) return false;
    const last = found.path[found.path.length - 1];
    const ex = tileX(last);
    const ey = tileY(last);
    let end: Point;
    const v = found.value;
    if (v.type === "fell") {
      // Beside the tree, a little towards it.
      end = { x: ex + 0.5 + (v.x - ex) * 0.3, y: ey + 0.5 + (v.y - ey) * 0.3 };
      w.task = { type: "fell", x: v.x, y: v.y };
      this.claimed.add(tileId(v.x, v.y));
    } else if (v.type === "pave") {
      end = { x: v.x + 0.5, y: v.y + 0.5 };
      w.task = { type: "pave", x: v.x, y: v.y };
      this.paveClaimed.add(tileId(v.x, v.y));
    } else if (v.type === "workshop") {
      const q = v.b;
      end =
        q.kind === "steinbruch"
          ? // At the rock face, somewhere along the quarry's back.
            { x: q.x + 0.4 + Math.random() * (q.w - 0.8), y: q.y + 0.6 }
          : q.kind === "druckerei" ||
              q.kind === "muehle" ||
              q.kind === "baeckerei" ||
              q.kind === "brauerei"
            ? // At the door.
              { x: q.x + 1.1 + Math.random() * 0.9, y: q.y + q.h - 0.3 }
            : // Out in the fields and pens.
              {
                x: q.x + 0.5 + Math.random() * (q.w - 1),
                y: q.y + 0.5 + Math.random() * (q.h - 1),
              };
      w.task = { type: "workshop", id: q.id };
    } else {
      const b = v.b;
      const nx = clamp(ex, b.x, b.x + b.w - 1);
      const ny = clamp(ey, b.y, b.y + b.h - 1);
      const onWater =
        b.kind === "bruecke" || b.kind === "schiff" || b.kind === "damm";
      end =
        !onWater && this.open(nx, ny)
          ? // On cleared ground: somewhere on the site.
            {
              x: b.x + 0.3 + Math.random() * (b.w - 0.6),
              y: b.y + 0.3 + Math.random() * (b.h - 0.6),
            }
          : // On the water: at the bank, facing the site.
            { x: ex + 0.5 + (nx - ex) * 0.35, y: ey + 0.5 + (ny - ey) * 0.35 };
      w.task = { type: "build", id: b.id };
    }
    w.route = this.route(w, found.path, found.via, end);
    w.ways = this.ways;
    w.phase = "walk";
    w.t = 0;
    return true;
  }

  /** Turns a path of tiles into straight stretches and crossings by ship. */
  private route(
    w: Worker,
    path: number[],
    via: Map<number, Ferry>,
    end: Point,
  ): Step[] {
    const steps: Step[] = [];
    const clear = (a: Point, b: Point) =>
      clearLine((x, y) => this.open(x, y), a, b);
    let stretch: Point[] = [{ x: w.x, y: w.y }];
    const flush = () => steps.push(...straighten(stretch, clear).slice(1));
    for (const id of path.slice(1)) {
      const ferry = via.get(id);
      if (ferry) {
        flush();
        steps.push({
          x: ferry.x,
          y: ferry.y,
          sail: { from: ferry.from, to: ferry.port },
        });
        stretch = [{ x: ferry.x, y: ferry.y }];
      } else stretch.push({ x: tileX(id) + 0.5, y: tileY(id) + 0.5 });
    }
    stretch.push(end);
    flush();
    return steps;
  }

  /** A hungry Waldmensch far from food looks for the way back to it. */
  private findFood(w: Worker): boolean | "later" {
    const p = this.people.nearestFood(w.x, w.y);
    if (!p) return false;
    if (this.searches <= 0) return "later";
    this.searches--;
    const found = search(
      {
        open: (x, y) => this.open(x, y),
        ferries: (id) => this.ferries().get(id),
      },
      Math.floor(w.x),
      Math.floor(w.y),
      (x, y) =>
        Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= balance.reach - 1
          ? { bias: 0, value: "eat" as const }
          : undefined,
      0,
      balance.searchTiles,
      new Set<number>(),
    );
    if (!found) return false;
    const last = found.path[found.path.length - 1];
    w.task = { type: "eat" };
    w.route = this.route(w, found.path, found.via, {
      x: tileX(last) + 0.5,
      y: tileY(last) + 0.5,
    });
    w.ways = this.ways;
    w.phase = "walk";
    w.t = 0;
    return true;
  }

  /** Advances the game by dt seconds; `instant` skips walking and sailing. */
  step(dt: number, instant: boolean) {
    this.searches = 2;
    for (const w of [...this.workers]) this.stepWorker(w, dt, instant);
    this.stepShips(dt, instant);
    this.stepRavens(dt, instant);
    this.people.step(dt);
    this.economy.step(dt);
    this.mood.step(dt);
    this.growth.step(dt);
    this.flood.step(dt);
    this.unlockClock -= dt;
    if (this.unlockClock <= 0) {
      this.unlockClock = 1;
      this.checkUnlocks();
    }
  }

  private unlockClock = 0;
  /** Seconds before a Waldmensch who found no way to food looks again, by id. */
  private foodRetry = new Map<number, number>();

  /** Whether a hungry Waldmensch should leave their work to eat. */
  private goesToEat(w: Worker, dt: number): boolean {
    const wait = (this.foodRetry.get(w.id) ?? 0) - dt;
    if (wait > 0) {
      this.foodRetry.set(w.id, wait);
      return false;
    }
    this.foodRetry.delete(w.id);
    return this.people.needsWalk(w);
  }

  private face(w: Worker, x: number, y: number) {
    // Facing follows the direction on screen, where x runs right and y left.
    const dx = x - w.x;
    const dy = y - w.y;
    if (dx - dy) w.facing = dx - dy > 0 ? 1 : -1;
  }

  private stepWorker(w: Worker, dt: number, instant: boolean) {
    w.t += dt;
    if (w.phase !== "sail") this.growth.trod(Math.floor(w.x), Math.floor(w.y));
    const hungry = w.task?.type !== "eat" && this.goesToEat(w, dt);
    if (w.phase === "idle") {
      // Look for work a few times a second, not every frame, and less often
      // while there is none within reach.
      if (w.t > 0.25) {
        if (hungry) {
          const found = this.findFood(w);
          if (found === "later") return;
          if (found) return;
          this.foodRetry.set(w.id, 10);
        }
        const found = this.findWork(w);
        if (found === "later") return;
        w.t = found ? 0 : -0.75 - Math.random() * 0.5;
      }
      return;
    }
    // On board, the ship carries the Waldmensch (stepShips).
    if (w.phase === "sail") return;
    const task = w.task;
    if (!task || w.ways !== this.ways) return this.idle(w);
    // Hungry and far from food: off to eat.
    if (hungry && w.phase !== "wait") return this.idle(w);
    if (task.type === "fell" && !this.isMarked(task.x, task.y))
      return this.idle(w);
    if (task.type === "pave" && !this.isPlannedPaving(task.x, task.y))
      return this.idle(w);
    if (task.type === "workshop" && w.job !== task.id) return this.idle(w);
    const site =
      task.type === "build"
        ? this.state.buildings.find(
            (b) => b.id === task.id && b.state === "site",
          )
        : undefined;
    if (task.type === "build" && !site) return this.idle(w);
    // At a quay, the ships see to it (stepShips).
    if (w.phase === "wait") return;

    if (w.phase === "walk") {
      if (instant && task.type !== "eat") {
        const last = w.route[w.route.length - 1];
        if (last) {
          w.x = last.x;
          w.y = last.y;
        }
        w.route = [];
      }
      // Cobbles make for quicker going.
      const paved = this.isPaved(Math.floor(w.x), Math.floor(w.y));
      let left = balance.walkSpeed * dt * (paved ? balance.pavedSpeed : 1);
      while (left > 0 && w.route.length) {
        const next = w.route[0];
        if (next.sail) {
          w.phase = "wait";
          w.t = 0;
          return;
        }
        const distance = Math.hypot(next.x - w.x, next.y - w.y);
        this.face(w, next.x, next.y);
        if (distance <= left) {
          w.x = next.x;
          w.y = next.y;
          w.route.shift();
          left -= distance;
        } else {
          w.x += ((next.x - w.x) / distance) * left;
          w.y += ((next.y - w.y) / distance) * left;
          left = 0;
        }
      }
      if (!w.route.length) {
        if (task.type === "eat") {
          this.people.eat(w);
          return this.idle(w);
        }
        w.phase = "work";
        w.t = 0;
        if (task.type === "fell") this.face(w, task.x + 0.5, task.y + 0.5);
        else if (site) this.face(w, site.x + site.w / 2, site.y + site.h / 2);
        else if (task.type === "workshop") this.face(w, w.x - 1, w.y - 1);
      }
      return;
    }

    const speed = this.mood.speed();
    if (task.type === "fell") {
      if (w.t * speed < balance.fellSeconds) return;
      this.fell(task.x, task.y);
      this.idle(w);
      return;
    }
    if (task.type === "pave") {
      if (w.t * speed < balance.paveSeconds) return;
      this.layStone(task.x, task.y);
      this.idle(w);
      return;
    }
    // In a producing building, the work goes on; the economy counts it.
    if (task.type === "workshop" || task.type === "eat") return;
    if (site) {
      site.work += dt * speed;
      if (site.work >= kinds[site.kind].work) this.finish(site);
    }
  }

  // --- Ships ------------------------------------------------------------

  /** Keeps a ship for every finished Schiff; Waldleute on a lost one go ashore. */
  private syncShips() {
    const ports = this.ports();
    for (const [id, s] of this.ships) {
      const b = this.state.buildings.find((other) => other.id === id);
      if (b?.state === "done") {
        s.lake = this.lakeOf(Math.floor(s.home.x), Math.floor(s.home.y));
        continue;
      }
      const job = s.job;
      const quay =
        (job && ports.get(job.phase === "carry" ? job.to : job.from)?.quay) ??
        fire;
      this.land(s, quay, false);
      this.ships.delete(id);
    }
    for (const b of this.state.buildings) {
      if (b.kind !== "schiff" || b.state !== "done" || this.ships.has(b.id))
        continue;
      const home = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      this.ships.set(b.id, {
        id: b.id,
        lake: this.lakeOf(b.x, b.y),
        home,
        x: home.x,
        y: home.y,
        axis: "x",
        route: [],
        passengers: [],
      });
    }
    this.ferryCache = null;
  }

  private sail(s: Ship, to: Point): Point[] {
    return waterRoute((x, y) => this.lakeOf(x, y) === s.lake, s, to);
  }

  private stepShips(dt: number, instant: boolean) {
    if (!this.ships.size) return;
    const ports = this.ports();
    // Waldleute waiting at a quay call a free ship of their lake.
    for (const w of this.workers) {
      if (w.phase !== "wait") continue;
      const sail = w.route[0]?.sail;
      const from = sail && ports.get(sail.from);
      if (!sail || !from || !ports.has(sail.to)) {
        this.idle(w);
        continue;
      }
      const ships = [...this.ships.values()];
      const coming = ships.some(
        (s) =>
          s.job?.phase === "fetch" &&
          s.job.from === sail.from &&
          s.job.to === sail.to,
      );
      if (coming) continue;
      let best: Ship | undefined;
      let bestDistance = Infinity;
      for (const s of ships) {
        if (s.lake !== from.lake || (s.job && s.job.phase !== "home")) continue;
        const d = Math.hypot(s.x - from.dock.x, s.y - from.dock.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = s;
        }
      }
      if (!best) continue;
      best.job = { from: sail.from, to: sail.to, phase: "fetch" };
      best.route = this.sail(best, from.dock);
    }
    for (const s of this.ships.values()) {
      if (instant && s.route.length) {
        const last = s.route[s.route.length - 1];
        s.x = last.x;
        s.y = last.y;
        s.route = [];
      }
      let left = balance.shipSpeed * dt;
      while (left > 0 && s.route.length) {
        const next = s.route[0];
        const dx = next.x - s.x;
        const dy = next.y - s.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.01) s.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (distance <= left) {
          s.x = next.x;
          s.y = next.y;
          s.route.shift();
          left -= distance;
        } else {
          s.x += (dx / distance) * left;
          s.y += (dy / distance) * left;
          left = 0;
        }
      }
      for (const p of s.passengers) {
        p.x = s.x;
        p.y = s.y;
      }
      if (!s.route.length && s.job) this.arrive(s);
    }
  }

  private arrive(s: Ship) {
    const job = s.job;
    if (!job) return;
    const ports = this.ports();
    if (job.phase === "home") {
      s.job = undefined;
      s.axis = "x";
      return;
    }
    if (job.phase === "fetch") {
      const to = ports.get(job.to);
      const boarding = to
        ? this.workers.filter((w) => {
            const sail = w.route[0]?.sail;
            return (
              w.phase === "wait" &&
              sail?.from === job.from &&
              sail.to === job.to
            );
          })
        : [];
      if (!to || !boarding.length) return this.goHome(s);
      for (const w of boarding) {
        w.phase = "sail";
        w.t = 0;
      }
      s.passengers.push(...boarding);
      job.phase = "carry";
      s.route = this.sail(s, to.dock);
      return;
    }
    const to = ports.get(job.to);
    this.land(s, to?.quay ?? ports.get(job.from)?.quay ?? fire, !!to);
    this.goHome(s);
  }

  /** Puts the passengers ashore; unless `planned`, they look for new work. */
  private land(s: Ship, at: Point, planned: boolean) {
    for (const w of s.passengers) {
      w.x = at.x;
      w.y = at.y;
      if (w.route[0]?.sail) w.route.shift();
      w.phase = "walk";
      w.t = 0;
      if (!planned || !w.task) this.idle(w);
      else if (!w.route.length) w.phase = "work";
    }
    s.passengers = [];
  }

  private goHome(s: Ship) {
    s.job = { from: 0, to: 0, phase: "home" };
    s.route = this.sail(s, s.home);
  }

  // --- Felling, finishing and the flood ------------------------------------

  private fell(x: number, y: number) {
    this.unmark(x, y);
    this.claimed.delete(tileId(x, y));
    if (!this.isTree(x, y)) return;
    this.setFelled(x, y);
    this.growth.clear(x, y);
    this.openCache.delete(tileId(x, y));
    this.economy.gain("wood", balance.woodPerTree);
    this.felledCount++;
    this.lastFelled = { x, y };
    this.events.tree(x, y);
    const t = this.textAt(x, y);
    if (t) {
      t.cleared++;
      this.events.text(t, t.cleared === 1);
      if (isExplored(t)) this.state.explored.add(t.key);
      // A found or freed text sends the raven on.
      if (t.cleared === 1 || isExplored(t)) this.ravenClock = 0;
    }
    this.events.dirty();
    this.checkSaw();
  }

  private finish(b: Building) {
    b.state = "done";
    b.work = kinds[b.kind].work;
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(false);
    if (b.kind === "huette") this.checkSaw();
    // A new producing building asks for a full crew.
    if (crewKinds.includes(b.kind)) {
      b.crew ??= balance.maxCrew;
      this.economy.syncCrews();
    }
    if (kinds[b.kind].upkeep) b.condition = 1;
    if (ravenKinds.includes(b.kind)) this.syncRavens();
    if (b.kind === "schiff") this.syncShips();
    this.events.building(b);
    this.events.dirty();
    this.checkUnlocks();
  }

  // --- Ravens -------------------------------------------------------------

  /** Keeps a raven for every finished Klause and Kloster in good condition. */
  syncRavens() {
    const homes = this.state.buildings.filter(
      (b) =>
        ravenKinds.includes(b.kind) &&
        b.state === "done" &&
        (b.condition ?? 1) >= balance.working,
    );
    for (let i = this.ravens.length - 1; i >= 0; i--)
      if (!homes.some((b) => b.id === this.ravens[i].id))
        this.ravens.splice(i, 1);
    for (const b of homes) {
      if (this.ravens.some((r) => r.id === b.id)) continue;
      const x = b.x + b.w / 2;
      const y = b.y + b.h / 2;
      this.ravens.push({
        id: b.id,
        x,
        y,
        goal: { x, y },
        orbit: this.ravens.length * Math.PI,
        facing: 1,
      });
    }
    this.ravenClock = 0;
  }

  /**
   * The open tile nearest a point: felled forest or the first clearing,
   * where the Waldleute could start felling towards it.
   */
  private nearestOpen(to: Point): Point {
    let best: Point = { x: start.x + 0.5, y: start.y + 0.5 };
    let bestD = Math.hypot(best.x - to.x, best.y - to.y);
    for (const [k, bits] of this.state.felled) {
      const [cx, cy] = k.split(",").map(Number);
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      const dx = Math.max(x0 - to.x, 0, to.x - x0 - CHUNK);
      const dy = Math.max(y0 - to.y, 0, to.y - y0 - CHUNK);
      if (Math.hypot(dx, dy) >= bestD) continue;
      for (let i = 0; i < CHUNK * CHUNK; i++) {
        if (!(bits[i >> 3] & (1 << (i & 7)))) continue;
        const x = x0 + (i % CHUNK) + 0.5;
        const y = y0 + Math.floor(i / CHUNK) + 0.5;
        const d = Math.hypot(x - to.x, y - to.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * Gives each raven a scroll to lead to: the unexplored ones, nearest the
   * first clearing first, one per raven while there are enough. A raven
   * circles about 500 m into the forest from the nearest felled ground
   * towards its scroll, and over the scroll itself once it is found. Without
   * a scroll left it circles its own building.
   */
  private guideRavens() {
    const scrolls = this.hidden
      .filter((t) => t.kind === "game" && !isExplored(t))
      .sort(
        (a, b) =>
          Math.hypot(a.x - start.x, a.y - start.y) -
          Math.hypot(b.x - start.x, b.y - start.y),
      );
    this.ravens.forEach((r, i) => {
      const t = scrolls.length ? scrolls[i % scrolls.length] : undefined;
      let goal: Point;
      if (!t) {
        const home = this.state.buildings.find((b) => b.id === r.id);
        goal = home
          ? { x: home.x + home.w / 2, y: home.y + home.h / 2 }
          : { x: r.x, y: r.y };
      } else {
        const centre = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
        if (isFound(t)) goal = centre;
        else {
          const from = this.nearestOpen(centre);
          const d = Math.hypot(centre.x - from.x, centre.y - from.y);
          const k = Math.min(balance.ravenLead, d) / (d || 1);
          goal = {
            x: from.x + (centre.x - from.x) * k,
            y: from.y + (centre.y - from.y) * k,
          };
        }
      }
      r.goal = goal;
      if (r.target !== t?.key) {
        r.target = t?.key;
        this.events.raven(r, t);
      }
    });
  }

  private stepRavens(dt: number, instant: boolean) {
    if (!this.ravens.length) return;
    this.ravenClock -= dt;
    if (this.ravenClock <= 0) {
      this.ravenClock = 2;
      this.guideRavens();
    }
    for (const r of this.ravens) {
      r.orbit += dt * 0.9;
      const want = {
        x: r.goal.x + Math.cos(r.orbit) * 1.8,
        y: r.goal.y + Math.sin(r.orbit) * 1.8,
      };
      const dx = want.x - r.x;
      const dy = want.y - r.y;
      const d = Math.hypot(dx, dy);
      const step = instant ? d : Math.min(d, balance.ravenSpeed * dt);
      if (d > 0.001) {
        r.x += (dx / d) * step;
        r.y += (dy / d) * step;
        // Facing follows the direction on screen, as for the Waldleute.
        if (Math.abs(dx - dy) > 0.01) r.facing = dx - dy > 0 ? 1 : -1;
      }
    }
  }
}
