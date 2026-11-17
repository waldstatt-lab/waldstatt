/**
 * The game's rules: Waldleute fell marked trees and build building sites,
 * sheep grow parchment, the printing press prints, and the finished dam floods
 * the Sihlsee. Waldleute walk in straight lines and wade through rivers; felled
 * wood counts at once. No rendering and no DOM here.
 */
import { balance, CHUNK, kinds, type Kind } from "./config";
import type { Building, Saved } from "./state";
import { damSite, hasBaseTree, isRiver, lakeTiles, start } from "./world";

export interface Worker {
  id: number;
  /** Position in tiles (fractional). */
  x: number;
  y: number;
  phase: "idle" | "walk" | "work";
  task?: { type: "fell"; x: number; y: number } | { type: "build"; id: number };
  /** Walk target. */
  tx: number;
  ty: number;
  /** Seconds in the current phase. */
  t: number;
  facing: 1 | -1;
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

export const hints = [
  "Nimm die Axt und zeig mir, welche Bäume fallen sollen.",
  "Gut! Mit 8 Holz bauen wir unter «Bauen» eine Hütte – aber nur auf freiem Boden. Fäll also genug Bäume.",
  "Zu zweit geht’s schneller. Die Säge markiert ganze Flächen. Bau als Nächstes ein Spielhaus: Dort wohnen unsere Spiele.",
  "Am Spielhaus hängt das Schild zum Spielen. Für Schriften brauchen wir Pergament – bau eine Schafweide.",
  "Schriftrollen brauchen so viel Platz wie ihr Text. Tippst du eine an, dreht sich die Karte, und du liest sie direkt im Wald.",
  "Die Druckerei druckt Anleitungen. Tippst du die Bühne des Theaters an, spielst du unsere Spiele direkt darauf an.",
  "Die Sihl liesse sich stauen. Aber was im Becken steht, geht unter.",
];

export class Game {
  readonly workers: Worker[] = [];
  /** Footprint tiles of every building, site and ruin. */
  private occupancy = new Map<string, Building>();
  private lake = new Set<string>();
  private claimed = new Set<string>();
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
    for (const [x, y] of lakeTiles()) this.lake.add(key(x, y));
    for (const b of state.buildings) {
      if (kinds[b.kind].fit) b.h = scrollHeight(b.kind, b.game);
      this.occupy(b);
    }
    this.syncWorkers();
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
    return this.lake.has(key(x, y));
  }

  isWater(x: number, y: number): boolean {
    return isRiver(x, y) || (this.state.flooded && this.isLake(x, y));
  }

  isTree(x: number, y: number): boolean {
    return (
      hasBaseTree(x, y) &&
      !this.isFelled(x, y) &&
      !(this.state.flooded && this.isLake(x, y))
    );
  }

  isMarked(x: number, y: number): boolean {
    return this.state.marks.has(key(x, y));
  }

  buildingAt(x: number, y: number): Building | undefined {
    return this.occupancy.get(key(x, y));
  }

  /** Marks or unmarks one tree. */
  toggleMark(x: number, y: number): "marked" | "unmarked" | "none" {
    if (!this.isTree(x, y)) return "none";
    const k = key(x, y);
    if (this.state.marks.has(k)) {
      this.state.marks.delete(k);
      this.events.tree(x, y);
      this.events.dirty();
      return "unmarked";
    }
    this.state.marks.add(k);
    this.events.tree(x, y);
    this.events.dirty();
    return "marked";
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
          this.state.marks.add(key(x, y));
          this.events.tree(x, y);
          count++;
        }
      }
    }
    if (count) this.events.dirty();
    return count;
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

  /** Checks a footprint whose top-left tile is (x, y). */
  placement(
    kind: Kind,
    game: string | undefined,
    x: number,
    y: number,
  ): Placement {
    const { w, h } = this.size(kind, game);
    if (kind === "damm") ({ x, y } = damSite);
    const tiles: Placement["tiles"] = [];
    const damPlanned = !!this.standing("damm") && !this.state.flooded;
    let reason: string | undefined;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        let tile: Placement["tiles"][number] = "free";
        if (this.occupancy.has(key(tx, ty))) {
          tile = "blocked";
          reason ??= "Da steht schon etwas.";
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
        const k = key(x, y);
        if (this.occupancy.get(k) === b) this.occupancy.delete(k);
        if (this.state.marks.delete(k)) this.events.tree(x, y);
      }
    }
    this.state.wood += Math.floor(kinds[b.kind].cost.wood * balance.refund);
    for (const w of this.workers)
      if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    this.syncWorkers();
    this.events.building(b, true);
    this.events.supplies();
    this.events.dirty();
  }

  private occupy(b: Building) {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) this.occupancy.set(key(x, y), b);
  }

  progress(b: Building): number {
    return Math.min(1, b.work / kinds[b.kind].work);
  }

  // --- Waldleute and production ------------------------------------------

  private syncWorkers() {
    const cap = this.workerCap();
    while (this.workers.length < cap) {
      const hut = [...this.state.buildings]
        .reverse()
        .find((b) => b.kind === "huette" && b.state === "done");
      const x = hut ? hut.x + hut.w / 2 : start.x + 0.5;
      const y = hut ? hut.y + hut.h + 0.2 : start.y + 0.6;
      this.workers.push({
        id: this.nextWorker++,
        x: x + (this.workers.length % 3) * 0.4 - 0.4,
        y,
        phase: "idle",
        tx: x,
        ty: y,
        t: 0,
        facing: 1,
      });
    }
    while (this.workers.length > cap) {
      const w = this.workers.pop();
      if (w) this.idle(w);
    }
  }

  private idle(w: Worker) {
    if (w.task?.type === "fell") this.claimed.delete(key(w.task.x, w.task.y));
    w.task = undefined;
    w.phase = "idle";
    w.t = 0;
  }

  private siteCrew(id: number): number {
    return this.workers.filter(
      (w) => w.task?.type === "build" && w.task.id === id,
    ).length;
  }

  private assign(w: Worker) {
    let best: Worker["task"];
    let bestScore = Infinity;
    for (const b of this.state.buildings) {
      if (b.state !== "site") continue;
      if (this.siteCrew(b.id) >= balance.workersPerSite) continue;
      const score = Math.hypot(b.x + b.w / 2 - w.x, b.y + b.h / 2 - w.y) - 4;
      if (score < bestScore) {
        bestScore = score;
        best = { type: "build", id: b.id };
      }
    }
    for (const k of this.state.marks) {
      if (this.claimed.has(k)) continue;
      const comma = k.indexOf(",");
      const x = Number(k.slice(0, comma));
      const y = Number(k.slice(comma + 1));
      // Building sites come first: their crews need no trees.
      const score = Math.hypot(x + 0.5 - w.x, y + 0.9 - w.y) + 6;
      if (score < bestScore) {
        bestScore = score;
        best = { type: "fell", x, y };
      }
    }
    if (!best) return;
    w.task = best;
    w.phase = "walk";
    w.t = 0;
    if (best.type === "fell") {
      this.claimed.add(key(best.x, best.y));
      w.tx = best.x + 0.5;
      w.ty = best.y + 0.95;
    } else {
      const b = this.state.buildings.find((other) => other.id === best.id);
      if (!b) return this.idle(w);
      w.tx = b.x + 0.3 + Math.random() * (b.w - 0.6);
      w.ty = b.y + 0.4 + Math.random() * (b.h - 0.6);
    }
  }

  /** Advances the game by dt seconds; `instant` skips walking. */
  step(dt: number, instant: boolean) {
    for (const w of this.workers) this.stepWorker(w, dt, instant);
    this.produce(dt);
  }

  private stepWorker(w: Worker, dt: number, instant: boolean) {
    w.t += dt;
    if (w.phase === "idle") {
      // Look for work a few times a second, not every frame.
      if (w.t > 0.25) {
        w.t = 0;
        this.assign(w);
      }
      return;
    }
    const task = w.task;
    if (!task) return this.idle(w);
    if (task.type === "fell" && !this.isMarked(task.x, task.y))
      return this.idle(w);
    const site =
      task.type === "build"
        ? this.state.buildings.find(
            (b) => b.id === task.id && b.state === "site",
          )
        : undefined;
    if (task.type === "build" && !site) return this.idle(w);

    if (w.phase === "walk") {
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const distance = Math.hypot(dx, dy);
      const stepLength = balance.walkSpeed * dt;
      // Facing follows the direction on screen, where x runs right and y left.
      if (dx - dy) w.facing = dx - dy > 0 ? 1 : -1;
      if (instant || distance <= stepLength) {
        w.x = w.tx;
        w.y = w.ty;
        w.phase = "work";
        w.t = 0;
      } else {
        w.x += (dx / distance) * stepLength;
        w.y += (dy / distance) * stepLength;
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

  private fell(x: number, y: number) {
    const k = key(x, y);
    this.state.marks.delete(k);
    this.claimed.delete(k);
    if (!this.isTree(x, y)) return;
    this.setFelled(x, y);
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
    if (b.kind === "huette") this.syncWorkers();
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
    const drowned = this.wouldDrown();
    for (const b of drowned) {
      b.state = "drowned";
      for (const w of this.workers)
        if (w.task?.type === "build" && w.task.id === b.id) this.idle(w);
    }
    for (const k of [...this.state.marks]) {
      if (this.lake.has(k)) {
        this.state.marks.delete(k);
        this.claimed.delete(k);
      }
    }
    for (const w of this.workers) {
      if (this.isLake(Math.floor(w.x), Math.floor(w.y))) {
        this.idle(w);
        w.x = damSite.x - 1;
        w.y = damSite.y + 1;
      }
    }
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
