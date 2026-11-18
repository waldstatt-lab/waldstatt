/**
 * The game's rules: Waldleute fell marked trees and build building sites,
 * sheep grow parchment, Waldleute break stones in quarries and print books
 * from parchment and wood in the printing house, and the finished dam floods
 * the Sihlsee. The site's texts lie hidden under the forest and are found by
 * felling it; the axe and the saw lie on the ground to be picked up, and
 * ravens show the way to the games' scrolls. Waldleute walk only on open ground (nav.ts): they fell their
 * way into the forest from its edge, cross rivers on bridges and the dam, and
 * cross a lake by ship between its ports. Felled wood counts at once. No
 * rendering and no DOM here.
 */
import {
  balance,
  CHUNK,
  crewKinds,
  kinds,
  placing,
  ravenKinds,
  supplies,
  texts,
  type Cost,
  type Kind,
  type TextKind,
} from "./config";
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
import type { Building, Saved } from "./state";
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
  lakeTiles,
  start,
  town,
} from "./world";

/** A point to walk to, or a crossing by ship that ends at (x, y). */
export interface Step extends Point {
  sail?: { from: number; to: number };
}

export interface Worker {
  id: number;
  /** Position in tiles (fractional). */
  x: number;
  y: number;
  /** "wait": at a quay for a ship; "sail": on board. */
  phase: "idle" | "walk" | "wait" | "sail" | "work";
  task?:
    | { type: "fell"; x: number; y: number }
    | { type: "build"; id: number }
    | { type: "pave"; x: number; y: number }
    | { type: "workshop"; id: number };
  /** The quarry or printing house this Waldmensch was put in, if any. */
  job?: number;
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
  flooded(drowned: Building[]): void;
  /** A hidden text was found, or more of it lies free. */
  text(t: HiddenText, found: boolean): void;
  /** A tile was cobbled, or planned for cobbles or no longer. */
  paving(x: number, y: number): void;
  /** The axe or the saw appeared or was picked up. */
  items(): void;
  /** A raven took up a new text to lead to, or came. */
  raven(r: Raven, text: HiddenText | undefined): void;
  /** The Waldmensch has something new to say. */
  hint(): void;
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

/** The Waldmensch's hints, one per milestone, in the order they are reached. */
export const hintCount = 16;

export class Game {
  readonly workers: Worker[] = [];
  readonly ships = new Map<number, Ship>();
  /** Footprint tiles of every building, site and ruin, by tile id. */
  private occupancy = new Map<number, Building>();
  /** The Sihlsee's basin. */
  private lake = new Set<number>();
  /** The marked trees, by tile id. */
  private marked = new Set<number>();
  /** Trees a Waldmensch is on the way to fell. */
  private claimed = new Set<number>();
  /** Tiles planned for cobbles, and those a Waldmensch is on the way to pave. */
  private paveSet = new Set<number>();
  private paveClaimed = new Set<number>();
  private stoneClock = 0;
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
  private pastureClock = 0;
  private pressClock = 0;
  private nextWorker = 1;

  constructor(
    readonly state: Saved,
    readonly gameIds: string[],
    /** The texts to hide in the forest, with their sizes. */
    specs: TextSpec[],
    private events: Events,
  ) {
    for (const [x, y] of lakeTiles()) this.lake.add(tileId(x, y));
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
    this.hideTexts(specs);
    this.syncWorkers();
    this.syncRavens();
    this.syncShips();
  }

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
    if (!this.paveSet.has(id) || this.state.stones < 1) return;
    this.paveSet.delete(id);
    this.state.paving.delete(key(x, y));
    if (!this.canPave(x, y)) return this.events.paving(x, y);
    this.state.stones--;
    const { chunk, index } = chunkOf(x, y);
    let bits = this.state.paved.get(chunk);
    if (!bits) {
      bits = new Uint8Array((CHUNK * CHUNK) / 8);
      this.state.paved.set(chunk, bits);
    }
    bits[index >> 3] |= 1 << (index & 7);
    this.events.paving(x, y);
    this.events.supplies();
    this.events.dirty();
    this.checkHint();
  }

  // --- The crews of quarries and the printing house -------------------------

  /** How many Waldleute work in a quarry or the printing house now. */
  crewOf(b: Building): number {
    return this.workers.filter((w) => w.job === b.id).length;
  }

  /** Puts Waldleute into a quarry or the printing house, or takes them out. */
  setCrew(b: Building, crew: number) {
    if (!crewKinds.includes(b.kind) || b.state !== "done") return;
    b.crew = clamp(crew, 0, balance.maxCrew);
    this.syncCrews();
    this.events.building(b);
    this.events.dirty();
  }

  /**
   * Gives every finished quarry and printing house the Waldleute it asks
   * for, as far as there are any: idle ones and those nearest first. The
   * others go back to work.
   */
  private syncCrews() {
    const workshops = this.state.buildings.filter(
      (b) => crewKinds.includes(b.kind) && b.state === "done",
    );
    for (const w of this.workers)
      if (w.job && !workshops.some((q) => q.id === w.job)) {
        w.job = undefined;
        this.idle(w);
      }
    for (const q of workshops) {
      const crew = this.workers.filter((w) => w.job === q.id);
      const want = Math.min(q.crew ?? 0, balance.maxCrew);
      while (crew.length > want) {
        const w = crew.pop() as Worker;
        w.job = undefined;
        this.idle(w);
      }
      while (crew.length < want) {
        const free = this.workers.filter((w) => !w.job && w.phase !== "sail");
        if (!free.length) break;
        const cx = q.x + q.w / 2;
        const cy = q.y + q.h / 2;
        free.sort(
          (a, b) =>
            Number(!!a.task) - Number(!!b.task) ||
            Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
        );
        const w = free[0];
        w.job = q.id;
        this.idle(w);
        crew.push(w);
      }
    }
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
  }

  isLake(x: number, y: number): boolean {
    return this.lake.has(tileId(x, y));
  }

  isWater(x: number, y: number): boolean {
    return isRiver(x, y) || (this.state.flooded && this.isLake(x, y));
  }

  /** Which lake's water a tile is, natural or the dammed Sihlsee; 0 for none. */
  lakeAt(x: number, y: number): number {
    return lakeAt(x, y, this.state.flooded);
  }

  private lakeOf(x: number, y: number): number {
    return lakeAt(x, y, this.state.flooded);
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
      !(this.state.flooded && this.isLake(x, y))
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

  /** Whether the game's scroll lies wholly free of trees. */
  explored(game: string): boolean {
    const t = this.text(`game:${game}`);
    return !!t && isExplored(t);
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
    this.checkHint();
    return item;
  }

  /** Lays the saw down once a hut stands and enough trees have fallen. */
  private checkSaw() {
    const s = this.state;
    if (s.tools.saw || s.sawAt || this.felledCount < balance.sawAfterTrees)
      return;
    if (!this.done("huette")) return;
    const at = this.lastFelled ?? this.home();
    s.sawAt = { x: Math.floor(at.x), y: Math.floor(at.y) };
    this.events.items();
    this.events.dirty();
    this.checkHint();
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
  private waysChanged(closed: boolean) {
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

  workerCap(): number {
    const huts = this.state.buildings.filter(
      (b) => b.kind === "huette" && b.state === "done",
    ).length;
    return Math.min(balance.maxWorkers, balance.startWorkers + huts);
  }

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

  /** Why a building cannot be chosen now, or undefined if it can. */
  unavailable(kind: Kind, game?: string): string | undefined {
    const info = kinds[kind];
    if (info.limit !== "many") {
      const existing = this.standing(
        kind,
        info.limit === "game" ? game : undefined,
      );
      if (existing)
        return existing.state === "site" ? "Ist schon im Bau." : "Steht schon.";
    }
    if (kind === "spielhaus" && game && !this.explored(game)) {
      const scroll = this.text(`game:${game}`);
      return scroll && isFound(scroll)
        ? "Erst wenn die ganze Schriftrolle frei liegt."
        : "Zuerst die Schriftrolle des Spiels im Wald finden.";
    }
    if (kind === "bibliothek" && game && !this.done("spielhaus", game))
      return "Braucht das fertige Spielhaus des Spiels.";
    if (kind === "theater" && !this.done("spielhaus"))
      return "Braucht ein fertiges Spielhaus.";
    if (kind === "schiff" && !this.done("hafen"))
      return "Braucht einen fertigen Hafen.";
    if (kind === "damm" && this.state.flooded)
      return "Der Sihlsee ist gestaut.";
    const missing: string[] = [];
    for (const { key, name } of supplies) {
      const lack = info.cost[key] - this.state[key];
      if (lack > 0) missing.push(`${lack} ${name}`);
    }
    if (missing.length) return `Es fehlen ${missing.join(", ")}.`;
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
    const damPlanned = !!this.standing("damm") && !this.state.flooded;
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
        } else if (kind === "schiff") {
          if (!this.lakeAt(tx, ty)) {
            tile = "blocked";
            reason ??= "Ein Schiff gehört aufs Wasser eines Sees.";
          }
        } else if (kind === "bruecke") {
          if (damPlanned && this.isLake(tx, ty)) {
            tile = "blocked";
            reason ??= "Hier wird der Sihlsee entstehen.";
          }
        } else if (kind !== "damm" && this.isWater(tx, ty)) {
          tile = "blocked";
          reason ??= "Nicht im Wasser.";
        } else if (kind !== "damm" && damPlanned && this.isLake(tx, ty)) {
          tile = "blocked";
          reason ??= "Hier wird der Sihlsee entstehen.";
        } else if (this.isTree(tx, ty)) {
          // Buildings stand only on cleared ground.
          tile = "tree";
          reason ??= "Zuerst die Bäume fällen.";
        }
        tiles.push(tile);
      }
    }
    if (
      !reason &&
      kind === "hafen" &&
      !this.beside(x, y, w, h, (tx, ty) => !!this.lakeAt(tx, ty))
    )
      reason = "Ein Hafen gehört ans Ufer eines Sees.";
    if (
      !reason &&
      kind === "schiff" &&
      !this.beside(x, y, w, h, (tx, ty) => {
        const b = this.buildingAt(tx, ty);
        return b?.kind === "hafen" && b.state === "done";
      })
    )
      reason = "Ein Schiff legt an einem fertigen Hafen an.";
    return { ok: !reason, reason, x, y, w, h, tiles };
  }

  /** Buildings the dam would drown. */
  wouldDrown(): Building[] {
    return this.state.buildings.filter(
      (b) => b.kind !== "damm" && b.state !== "drowned" && this.inLake(b),
    );
  }

  private inLake(b: Building): boolean {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) if (this.isLake(x, y)) return true;
    return false;
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
    for (const { key } of supplies) this.state[key] -= info.cost[key];
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
    this.waysChanged(false);
    this.events.building(b);
    this.events.supplies();
    this.events.dirty();
    this.checkHint();
    return b;
  }

  /** What tearing a building down gives back: half its costs, rounded down. */
  refund(b: Building): Cost {
    const cost = kinds[b.kind].cost;
    const back = (n: number) => Math.floor(n * balance.refund);
    return {
      wood: back(cost.wood),
      parchment: back(cost.parchment),
      stones: back(cost.stones),
      books: back(cost.books),
    };
  }

  canDemolish(b: Building): boolean {
    return b.state !== "drowned" && !(b.kind === "damm" && b.state === "done");
  }

  demolish(b: Building) {
    if (!this.canDemolish(b)) return;
    this.state.buildings = this.state.buildings.filter((other) => other !== b);
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const id = tileId(x, y);
        if (this.occupancy.get(id) === b) this.occupancy.delete(id);
        if (this.unmark(x, y)) this.events.tree(x, y);
      }
    }
    const refund = this.refund(b);
    for (const { key } of supplies) this.state[key] += refund[key];
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(true);
    this.syncShips();
    this.syncWorkers();
    this.syncCrews();
    this.syncRavens();
    this.events.building(b, true);
    this.events.supplies();
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

  /** Where Waldleute appear: by the newest hut, or in the first clearing. */
  private home(): Point {
    const hut = [...this.state.buildings]
      .reverse()
      .find((b) => b.kind === "huette" && b.state === "done");
    return hut
      ? { x: hut.x + hut.w / 2, y: hut.y + hut.h + 0.2 }
      : { x: start.x + 0.5, y: start.y + 0.6 };
  }

  private syncWorkers() {
    const cap = this.workerCap();
    while (this.workers.length < cap) {
      const { x, y } = this.home();
      this.workers.push({
        id: this.nextWorker++,
        x: x + (this.workers.length % 3) * 0.4 - 0.4,
        y,
        phase: "idle",
        route: [],
        ways: this.ways,
        t: 0,
        facing: 1,
      });
    }
    while (this.workers.length > cap) {
      const w = this.workers.pop();
      if (!w) break;
      this.idle(w);
      for (const s of this.ships.values())
        s.passengers = s.passengers.filter((p) => p !== w);
    }
    this.syncCrews();
  }

  private idle(w: Worker) {
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
      this.state.stones > this.paveClaimed.size;
    // A Waldmensch put in a quarry or the printing house looks only for the
    // way there.
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
          : // At the printing house's door, by the sheets drying.
            { x: q.x + 1.1 + Math.random() * 0.9, y: q.y + q.h - 0.3 };
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

  /** Advances the game by dt seconds; `instant` skips walking and sailing. */
  step(dt: number, instant: boolean) {
    this.searches = 2;
    for (const w of this.workers) this.stepWorker(w, dt, instant);
    this.stepShips(dt, instant);
    this.stepRavens(dt, instant);
    this.produce(dt);
  }

  private face(w: Worker, x: number, y: number) {
    // Facing follows the direction on screen, where x runs right and y left.
    const dx = x - w.x;
    const dy = y - w.y;
    if (dx - dy) w.facing = dx - dy > 0 ? 1 : -1;
  }

  private stepWorker(w: Worker, dt: number, instant: boolean) {
    w.t += dt;
    if (w.phase === "idle") {
      // Look for work a few times a second, not every frame, and less often
      // while there is none within reach.
      if (w.t > 0.25) {
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
      if (instant) {
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
        w.phase = "work";
        w.t = 0;
        if (task.type === "fell") this.face(w, task.x + 0.5, task.y + 0.5);
        else if (site) this.face(w, site.x + site.w / 2, site.y + site.h / 2);
        else if (task.type === "workshop") this.face(w, w.x - 1, w.y - 1);
      }
      return;
    }

    if (task.type === "fell") {
      if (w.t < balance.fellSeconds) return;
      this.fell(task.x, task.y);
      this.idle(w);
      return;
    }
    if (task.type === "pave") {
      if (w.t < balance.paveSeconds) return;
      this.layStone(task.x, task.y);
      this.idle(w);
      return;
    }
    // In a quarry or the printing house, the work goes on; produce() counts
    // the stones and books.
    if (task.type === "workshop") return;
    if (site) {
      site.work += dt;
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
        this.home();
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
    this.land(s, to?.quay ?? ports.get(job.from)?.quay ?? this.home(), !!to);
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
    this.openCache.delete(tileId(x, y));
    this.state.wood += balance.woodPerTree;
    this.felledCount++;
    this.lastFelled = { x, y };
    this.events.tree(x, y);
    const t = this.textAt(x, y);
    if (t) {
      t.cleared++;
      this.events.text(t, t.cleared === 1);
      // A found or freed text sends the raven on.
      if (t.cleared === 1 || isExplored(t)) this.ravenClock = 0;
    }
    this.events.supplies();
    this.events.dirty();
    this.checkSaw();
    this.checkHint();
  }

  private finish(b: Building) {
    b.state = "done";
    b.work = kinds[b.kind].work;
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(false);
    if (b.kind === "huette") this.syncWorkers();
    if (b.kind === "huette") this.checkSaw();
    if (crewKinds.includes(b.kind)) this.syncCrews();
    if (ravenKinds.includes(b.kind)) this.syncRavens();
    if (b.kind === "schiff") this.syncShips();
    if (b.kind === "damm") this.flood();
    this.events.building(b);
    this.events.dirty();
    this.checkHint();
  }

  private shownHint = "";

  /** Whether any of the town's texts or a game's scroll was found. */
  private foundAny(where: "town" | "far"): boolean {
    return this.hidden.some((t) => texts[t.kind].where === where && isFound(t));
  }

  /**
   * The milestones in the order a visitor reaches them; the first not yet
   * reached is the current hint.
   */
  private milestones(): (() => boolean)[] {
    return [
      () => this.state.tools.axe,
      () => this.felledCount > 0,
      () => this.done("huette"),
      () => !!this.state.sawAt || this.state.tools.saw,
      () => this.state.tools.saw,
      () => this.foundAny("town"),
      () => this.done("klause") || this.done("kloster"),
      () => this.foundAny("far"),
      () => this.gameIds.some((g) => this.explored(g)),
      () => this.done("schafweide"),
      () => this.done("spielhaus"),
      () => this.done("steinbruch") || this.state.paved.size > 0,
      () => this.done("druckerei"),
      () => this.done("bibliothek") || this.done("theater"),
      () => !!this.standing("damm") || this.state.flooded,
      () => this.done("bruecke") || this.done("schiff"),
    ];
  }

  /** The first milestone not yet reached; hintCount when all are. */
  currentHint(): number {
    const index = this.milestones().findIndex((reached) => !reached());
    return index < 0 ? hintCount : Math.min(index, hintCount);
  }

  /** What the Waldmensch says for the current milestone. */
  hintText(): string {
    const scroll = this.hidden.find(
      (t) => t.kind === "game" && isFound(t) && !isExplored(t),
    );
    switch (this.currentHint()) {
      case 0:
        return "Da liegt meine Axt im Gras. Tipp sie an und nimm sie mit.";
      case 1:
        return "Zeig mir mit der Axt, welche Bäume fallen sollen. Durch den Wald komme ich nur, wo er gefällt ist.";
      case 2:
        return "Gut! Mit 8 Holz bauen wir unter «Bauen» eine Hütte – aber nur auf freiem Boden.";
      case 3:
        return `Zu zweit geht’s schneller. Fällt weiter: Nach ${balance.sawAfterTrees} Bäumen findet sich bestimmt etwas Nützliches.`;
      case 4:
        return "Da liegt eine Säge, wo eben der Baum fiel! Tipp sie an: Mit ihr markierst du ganze Flächen.";
      case 5:
        return "Im Süden liegt Einsiedeln. Keinen Kilometer um das Kloster liegen alte Schriften unter den Bäumen. Wo der Waldboden hell schimmert, lohnt sich das Fällen.";
      case 6:
        return "Hier lebte einst der Einsiedler Meinrad, und zwei Raben leisteten ihm Gesellschaft. Bau unter «Bauen» seine Klause: Ein Rabe kennt den Weg zu unseren Spielen.";
      case 7:
        return "Folge dem Raben: Er kreist über dem Wald, den wir als Nächstes fällen müssen. Irgendwo dahinter liegt die Schriftrolle eines Spiels.";
      case 8:
        return scroll
          ? "Eine Schriftrolle! Fällt alle Bäume darüber, dann liegt das Spiel frei."
          : "Folge dem Raben weiter. Fällt alle Bäume über der Schriftrolle, dann liegt das Spiel frei.";
      case 9:
        return "Für das Spielhaus brauchen wir Pergament. Bau eine Schafweide.";
      case 10:
        return "Das Spiel liegt frei: Unter «Bauen» steht sein Spielhaus bereit.";
      case 11:
        return "Tipp ein Spielhaus an, und das Spiel öffnet sich in einem neuen Tab. Bau einen Steinbruch: Tippst du ihn an, schickst du Waldleute hinein, die Steine brechen.";
      case 12:
        return "Mit Steinen pflastern wir Wege und Plätze: Nimm «Pflastern» und zieh über freien Boden. Auf Pflaster gehen wir schneller, und Schriften bleiben lesbar. Bau auch eine Druckerei und schick Waldleute hinein: Aus Pergament und Holz drucken sie Bücher.";
      case 13:
        return "Mit Büchern bauen wir jedem Spiel eine Bibliothek: Tippst du sie an, öffnet sich sein Quellcode in einem neuen Tab. Im Theater spielst du die Spiele an.";
      case 14:
        return "Die Sihl liesse sich stauen. Aber was im Becken steht, geht unter.";
      default:
        return "Schwimmen können wir nicht. Über Flüsse führen Brücken; an einem See bauen wir Häfen, und Schiffe bringen uns hinüber.";
    }
  }

  /** Tells the interface when the Waldmensch has something new to say. */
  checkHint() {
    const current = String(this.currentHint());
    if (current !== this.shownHint) {
      this.shownHint = current;
      this.events.hint();
    }
  }

  // --- Ravens -------------------------------------------------------------

  /** Keeps a raven for every finished Klause and Kloster. */
  private syncRavens() {
    const homes = this.state.buildings.filter(
      (b) => ravenKinds.includes(b.kind) && b.state === "done",
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

  private flood() {
    this.state.flooded = true;
    const drowned = this.wouldDrown();
    for (const b of drowned) {
      b.state = "drowned";
      for (const w of this.workers)
        if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    }
    for (const k of [...this.state.marks]) {
      const [x, y] = k.split(",").map(Number);
      if (this.isLake(x, y)) {
        this.unmark(x, y);
        this.claimed.delete(tileId(x, y));
      }
    }
    for (const w of this.workers) {
      if (this.isLake(Math.floor(w.x), Math.floor(w.y))) {
        this.idle(w);
        w.x = damSite.x - 1;
        w.y = damSite.y + 1;
      }
    }
    this.waysChanged(true);
    this.syncShips();
    if (this.workerCap() < this.workers.length) this.syncWorkers();
    this.events.flooded(drowned);
    this.events.supplies();
  }

  private produce(dt: number) {
    const s = this.state;
    // Waldleute at work in a quarry or the printing house, by its kind.
    let breaking = 0;
    let printing = 0;
    for (const w of this.workers) {
      if (w.task?.type !== "workshop" || w.phase !== "work") continue;
      const id = w.task.id;
      const kind = s.buildings.find((b) => b.id === id)?.kind;
      if (kind === "steinbruch") breaking++;
      else if (kind === "druckerei") printing++;
    }
    if (breaking && s.stones < balance.maxStones) {
      this.stoneClock += dt * breaking;
      if (this.stoneClock >= balance.stoneSeconds) {
        this.stoneClock -= balance.stoneSeconds;
        s.stones++;
        // New stones may let paving go on.
        this.chances++;
        this.events.supplies();
        this.events.dirty();
      }
    } else this.stoneClock = 0;
    const pastures = s.buildings.filter(
      (b) => b.kind === "schafweide" && b.state === "done",
    ).length;
    if (pastures && s.parchment < balance.maxParchment) {
      this.pastureClock += dt * pastures;
      if (this.pastureClock >= balance.parchmentSeconds) {
        this.pastureClock -= balance.parchmentSeconds;
        s.parchment++;
        this.events.supplies();
        this.events.dirty();
      }
    } else this.pastureClock = 0;
    if (
      printing &&
      s.parchment >= balance.bookParchment &&
      s.wood >= balance.bookWood &&
      s.books < balance.maxBooks
    ) {
      this.pressClock += dt * printing;
      if (this.pressClock >= balance.bookSeconds) {
        this.pressClock -= balance.bookSeconds;
        s.parchment -= balance.bookParchment;
        s.wood -= balance.bookWood;
        s.books++;
        this.events.supplies();
        this.events.dirty();
      }
    } else this.pressClock = 0;
  }
}
