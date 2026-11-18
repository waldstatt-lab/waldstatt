/**
 * The game's rules: Waldleute fell marked trees and build building sites,
 * sheep grow parchment, the printing press prints, and the finished dam floods
 * the Sihlsee. Waldleute walk only on open ground (nav.ts): they fell their
 * way into the forest from its edge, cross rivers on bridges and the dam, and
 * cross a lake by ship between its ports. Felled wood counts at once. No
 * rendering and no DOM here.
 */
import { balance, CHUNK, kinds, type Kind } from "./config";
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
  isRiver,
  lakeLabels,
  lakeTiles,
  start,
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
  task?: { type: "fell"; x: number; y: number } | { type: "build"; id: number };
  /** The way still ahead. */
  route: Step[];
  /** The ways as they were when the route was found (Game.ways). */
  ways: number;
  /** Seconds in the current phase. */
  t: number;
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

export const hints = [
  "Nimm die Axt und zeig mir, welche Bäume fallen sollen. Durch den Wald komme ich nur, wo er gefällt ist.",
  "Gut! Mit 8 Holz bauen wir unter «Bauen» eine Hütte – aber nur auf freiem Boden. Fäll also genug Bäume.",
  "Zu zweit geht’s schneller. Die Säge markiert ganze Flächen. Bau als Nächstes ein Spielhaus: Dort wohnen unsere Spiele.",
  "Am Spielhaus hängt das Schild zum Spielen. Für Schriften brauchen wir Pergament – bau eine Schafweide.",
  "Schriftrollen brauchen so viel Platz wie ihr Text. Tippst du eine an, dreht sich die Karte, und du liest sie direkt im Wald.",
  "Die Druckerei druckt Anleitungen. Tippst du die Bühne des Theaters an, spielst du unsere Spiele direkt darauf an.",
  "Die Sihl liesse sich stauen. Aber was im Becken steht, geht unter.",
  "Schwimmen können wir nicht. Über Flüsse führen Brücken; an einem See bauen wir Häfen, und Schiffe bringen uns hinüber.",
];

export class Game {
  readonly workers: Worker[] = [];
  readonly ships = new Map<number, Ship>();
  /** Footprint tiles of every building, site and ruin, by tile id. */
  private occupancy = new Map<number, Building>();
  /** The Sihlsee's basin. */
  private lake = new Set<number>();
  /** Which lake's water a tile is, 0 for none. */
  private lakeOf: (x: number, y: number) => number;
  /** The marked trees, by tile id. */
  private marked = new Set<number>();
  /** Trees a Waldmensch is on the way to fell. */
  private claimed = new Set<number>();
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
  private pastureClock = 0;
  private pressClock = 0;
  private nextWorker = 1;

  constructor(
    readonly state: Saved,
    readonly gameIds: string[],
    /** A scroll's height in tiles, from its text. */
    private scrollHeight: (kind: Kind, game?: string) => number,
    private events: Events,
  ) {
    for (const [x, y] of lakeTiles()) this.lake.add(tileId(x, y));
    this.lakeOf = lakeLabels(state.flooded);
    for (const k of state.marks) {
      const [x, y] = k.split(",").map(Number);
      this.marked.add(tileId(x, y));
    }
    for (const b of state.buildings) {
      if (kinds[b.kind].fit) b.h = scrollHeight(b.kind, b.game);
      this.occupy(b);
    }
    this.syncWorkers();
    this.syncShips();
  }

  // --- The forest -------------------------------------------------------

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
    return this.lakeOf(x, y);
  }

  isTree(x: number, y: number): boolean {
    return (
      hasBaseTree(x, y) &&
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
    if (!this.isTree(x, y)) return "none";
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
        if (this.isTree(x, y) && !this.isMarked(x, y)) {
          this.mark(x, y);
          this.events.tree(x, y);
          count++;
        }
      }
    }
    if (count) this.events.dirty();
    return count;
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
      open = !this.isTree(x, y) && (crossing || !this.isWater(x, y));
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

  size(kind: Kind, game?: string): { w: number; h: number } {
    const info = kinds[kind];
    return {
      w: info.w,
      h: info.fit ? this.scrollHeight(kind, game) : info.h,
    };
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
    if (kind === "theater" && !this.done("spielhaus"))
      return "Braucht ein fertiges Spielhaus.";
    if (kind === "schiff" && !this.done("hafen"))
      return "Braucht einen fertigen Hafen.";
    if (kind === "damm" && this.state.flooded)
      return "Der Sihlsee ist gestaut.";
    const missing: string[] = [];
    const { wood, parchment, prints } = info.cost;
    if (this.state.wood < wood) missing.push(`${wood - this.state.wood} Holz`);
    if (this.state.parchment < parchment)
      missing.push(`${parchment - this.state.parchment} Pergament`);
    if (this.state.prints < prints)
      missing.push(`${prints - this.state.prints} Drucke`);
    if (missing.length) return `Es fehlen ${missing.join(", ")}.`;
    return undefined;
  }

  /**
   * Checks a footprint whose top-left tile is (x, y). The dam has its fixed
   * site; a bridge spans the river from the tile (x, y) to both banks.
   */
  placement(
    kind: Kind,
    game: string | undefined,
    x: number,
    y: number,
  ): Placement {
    let { w, h } = this.size(kind, game);
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
    const spot = this.placement(kind, game, x, y);
    if (!spot.ok) return undefined;
    const info = kinds[kind];
    this.state.wood -= info.cost.wood;
    this.state.parchment -= info.cost.parchment;
    this.state.prints -= info.cost.prints;
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
    this.state.wood += Math.floor(kinds[b.kind].cost.wood * balance.refund);
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(true);
    this.syncShips();
    this.syncWorkers();
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
  }

  private idle(w: Worker) {
    // A freed tree or place in a crew is work for somebody else.
    if (w.task) this.chances++;
    if (w.task?.type === "fell")
      this.claimed.delete(tileId(w.task.x, w.task.y));
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
    if (!sites && !trees) return false;
    const sx = Math.floor(w.x);
    const sy = Math.floor(w.y);
    // Another Waldmensch just searched here in vain.
    if (
      this.noWork?.chances === this.chances &&
      this.noWork.tiles.has(tileId(sx, sy))
    )
      return false;
    type Found =
      { type: "fell"; x: number; y: number } | { type: "build"; b: Building };
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
      const b = sites ? siteNear.get(tileId(x, y)) : undefined;
      if (b) return { bias: -4, value: { type: "build", b } as Found };
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
    const searched = this.noWork.tiles;
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
      let left = balance.walkSpeed * dt;
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
      }
      return;
    }

    if (task.type === "fell") {
      if (w.t < balance.fellSeconds) return;
      this.fell(task.x, task.y);
      this.idle(w);
      return;
    }
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
    this.events.tree(x, y);
    this.events.supplies();
    this.events.dirty();
    this.checkHint();
  }

  private finish(b: Building) {
    b.state = "done";
    b.work = kinds[b.kind].work;
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.waysChanged(false);
    if (b.kind === "huette") this.syncWorkers();
    if (b.kind === "schiff") this.syncShips();
    if (b.kind === "damm") this.flood();
    this.events.building(b);
    this.events.dirty();
    this.checkHint();
  }

  private shownHint = -1;

  /** The first milestone not yet reached; hints.length when all are. */
  currentHint(): number {
    const milestones = [
      () => this.state.felled.size > 0,
      () => this.done("huette"),
      () => this.done("spielhaus"),
      () => this.done("schafweide"),
      () => this.done("chronik") || this.done("spielidee"),
      () => this.done("druckerei") || this.done("theater"),
      () => !!this.standing("damm") || this.state.flooded,
      () => this.done("bruecke") || this.done("schiff"),
    ];
    const index = milestones.findIndex((reached) => !reached());
    return index < 0 ? hints.length : index;
  }

  /** Tells the interface when the Waldmensch has something new to say. */
  checkHint() {
    const current = this.currentHint();
    if (current !== this.shownHint) {
      this.shownHint = current;
      this.events.hint();
    }
  }

  private flood() {
    this.state.flooded = true;
    this.lakeOf = lakeLabels(true);
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
      this.done("druckerei") &&
      s.parchment > 0 &&
      s.prints < balance.maxPrints
    ) {
      this.pressClock += dt;
      if (this.pressClock >= balance.printSeconds) {
        this.pressClock = 0;
        s.parchment--;
        s.prints++;
        this.events.supplies();
        this.events.dirty();
      }
    } else this.pressClock = 0;
  }
}
