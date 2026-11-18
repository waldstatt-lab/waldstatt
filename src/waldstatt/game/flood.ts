/**
 * The Sihlsee and the flood wave. While the dam stands, the Sihl rises: water
 * spreads from the river through the basin, tile by tile, in a fixed order,
 * until the lake is full after about 15 minutes; trees go under, buildings
 * sink slowly, and Waldleute step back from the water. When the dam is torn
 * down, a wave runs down the Sihl towards the Zürichsee, destroys the
 * buildings in its way and goes back after a few minutes, and the basin
 * drains in the reverse order. Churches and the Kloster come back as ruins;
 * what else lay in the basin is gone. The save keeps only how full the lake
 * is and how long ago the wave began.
 */
import { balance, stoneKinds } from "./config";
import { tileId, tileX, tileY } from "./nav";
import type { Game } from "./sim";
import type { Building } from "./state";
import { damSite, isRiver, lakeTiles, loadedPages, loadPages } from "./world";

/** The pages the Sihl runs through from the dam to Zürich, in tiles. */
const sihlArea = { x0: -400, y0: -600, x1: 80, y1: -1 };

export class Flood {
  /** The basin's tiles in the order they fill. */
  private order: number[] = [];
  private rank = new Map<number, number>();
  /** Tiles under water now. */
  private count = 0;
  /** The wave's tiles by their distance from the dam, once known. */
  private band: Map<number, number> | null = null;
  private bandLength = 0;
  private bandLoading = false;
  /** How far the wave had come at the last step, in tiles. */
  private front = -1;
  private clock = 0;

  constructor(private g: Game) {
    const basin = new Set(lakeTiles().map(([x, y]) => tileId(x, y)));
    // The water rises from the Sihl, or, if its course is not known, from
    // the dam.
    let seeds = [...basin].filter((id) => isRiver(tileX(id), tileY(id)));
    if (!seeds.length) {
      const near = (id: number) =>
        Math.hypot(
          tileX(id) - damSite.x - damSite.w / 2,
          tileY(id) - damSite.y - damSite.h / 2,
        );
      seeds = [...basin].sort((a, b) => near(a) - near(b)).slice(0, 3);
    }
    const seen = new Set(seeds);
    const queue = [...seeds];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const x = tileX(id);
      const y = tileY(id);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = tileId(x + dx, y + dy);
        if (!basin.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    // Basin tiles cut off from the river fill last.
    for (const id of basin) if (!seen.has(id)) queue.push(id);
    this.order = queue;
    queue.forEach((id, i) => this.rank.set(id, i));
    this.count = this.target();
    if (g.state.flood.wave !== null) void this.prepareWave();
  }

  /** How many tiles the level puts under water. */
  private target(): number {
    return Math.floor(this.g.state.flood.level * this.order.length);
  }

  isBasin(x: number, y: number): boolean {
    return this.rank.has(tileId(x, y));
  }

  /** Whether the Sihlsee covers a tile now. */
  flooded(x: number, y: number): boolean {
    const r = this.rank.get(tileId(x, y));
    return r !== undefined && r < this.count;
  }

  /** Whether any of the Sihlsee is there. */
  get any(): boolean {
    return this.count > 0;
  }

  /** Whether the Sihlsee is full. */
  get full(): boolean {
    return this.count >= this.order.length;
  }

  /** Whether the flood wave covers a tile now. */
  waved(x: number, y: number): boolean {
    const d = this.band?.get(tileId(x, y));
    if (d === undefined) return false;
    return d <= this.front && this.front - d < this.reachBack();
  }

  /** The tiles the flood wave covers now. */
  waveTiles(): [number, number][] {
    if (!this.band || this.front < 0) return [];
    const tiles: [number, number][] = [];
    const back = this.reachBack();
    for (const [id, d] of this.band)
      if (d <= this.front && this.front - d < back)
        tiles.push([tileX(id), tileY(id)]);
    return tiles;
  }

  private reachBack() {
    return balance.waveStays * balance.waveSpeed;
  }

  /** The dam was torn down: the wave sets off, and the lake drains. */
  breakDam() {
    if (!this.any) return;
    this.g.state.flood.wave = 0;
    this.front = -1;
    void this.prepareWave();
  }

  private async prepareWave() {
    if (this.band || this.bandLoading) return;
    this.bandLoading = true;
    const a = sihlArea;
    await loadPages(a.x0, a.y0, a.x1, a.y1);
    // Every tile within reach of the Sihl outside the basin, then only those
    // joined to the dam, by their distance from it.
    const near = new Set<number>();
    const w = balance.waveBand;
    for (const page of loadedPages()) {
      for (const line of page.data?.lines ?? []) {
        if (line.name !== "Sihl") continue;
        const p = line.points;
        for (let i = 2; i < p.length; i += 2) {
          const steps =
            Math.ceil(Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]) * 2) + 1;
          for (let s = 0; s <= steps; s++) {
            const x = p[i - 2] + ((p[i] - p[i - 2]) * s) / steps;
            const y = p[i - 1] + ((p[i + 1] - p[i - 1]) * s) / steps;
            for (let ty = Math.floor(y - w); ty <= Math.ceil(y + w); ty++)
              for (let tx = Math.floor(x - w); tx <= Math.ceil(x + w); tx++)
                if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= w)
                  near.add(tileId(tx, ty));
          }
        }
      }
    }
    for (const id of this.order) near.delete(id);
    const band = new Map<number, number>();
    const queue: number[] = [];
    for (let y = damSite.y - 3; y <= damSite.y + damSite.h + 2; y++)
      for (let x = damSite.x - 3; x <= damSite.x + damSite.w + 2; x++) {
        const id = tileId(x, y);
        if (near.has(id) && !band.has(id)) {
          band.set(id, 0);
          queue.push(id);
        }
      }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const d = band.get(id) ?? 0;
      const x = tileX(id);
      const y = tileY(id);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = tileId(x + dx, y + dy);
        if (!near.has(next) || band.has(next)) continue;
        band.set(next, d + 1);
        queue.push(next);
      }
    }
    this.band = band;
    this.bandLength = Math.max(0, ...band.values());
    this.bandLoading = false;
  }

  step(dt: number) {
    const s = this.g.state;
    const dam = this.g.state.buildings.find(
      (b) => b.kind === "damm" && b.state === "done",
    );
    if (dam && s.flood.level < 1)
      s.flood.level = Math.min(1, s.flood.level + dt / balance.fillSeconds);
    else if (!dam && s.flood.level > 0)
      s.flood.level = Math.max(0, s.flood.level - dt / balance.drainSeconds);
    if (s.flood.wave !== null && this.band) s.flood.wave += dt;
    this.sink(dt);
    // The rest a few times a second: changes of the water mean new ways.
    this.clock += dt;
    if (this.clock < 0.5) return;
    this.clock = 0;
    const target = this.target();
    if (target !== this.count) this.level(target);
    if (s.flood.wave !== null && this.band) this.runWave();
  }

  /** Raises or lowers the water to `target` tiles. */
  private level(target: number) {
    const g = this.g;
    const rising = target > this.count;
    const changed = rising
      ? this.order.slice(this.count, target)
      : this.order.slice(target, this.count);
    this.count = target;
    for (const id of changed) {
      const x = tileX(id);
      const y = tileY(id);
      if (rising) {
        // Trees under water die; when it drains, the ground is bare.
        g.drown(x, y);
      }
      g.events.tree(x, y);
    }
    if (rising) this.stepBack((x, y) => this.flooded(x, y));
    else this.drained();
    g.waysChanged(true);
    g.events.flood();
    g.events.dirty();
  }

  /** Buildings the water reached sink slowly. */
  private sink(dt: number) {
    if (!this.any) return;
    for (const b of this.g.state.buildings) {
      if (b.kind === "damm" || b.kind === "schiff") continue;
      if (b.state !== "drowned" && !this.touches(b)) continue;
      if (b.state !== "drowned") {
        b.state = "drowned";
        b.sunk = 0;
        this.g.lost(b);
      }
      const sunk = Math.min(1, (b.sunk ?? 0) + dt / balance.sinkSeconds);
      // Redraw only in steps, not every frame.
      const step = (n: number) => Math.floor(n * 20);
      const redraw = step(sunk) !== step(b.sunk ?? 0);
      b.sunk = sunk;
      if (redraw) this.g.events.building(b);
    }
  }

  private touches(b: Building): boolean {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) if (this.flooded(x, y)) return true;
    return false;
  }

  /** The lake drained from some tiles: what lay there comes back or is gone. */
  private drained() {
    const g = this.g;
    let ruins = 0;
    for (const b of [...g.state.buildings]) {
      if (b.state !== "drowned" || this.touches(b)) continue;
      if (stoneKinds.includes(b.kind)) {
        b.state = "ruin";
        b.condition = 0;
        b.sunk = undefined;
        ruins++;
        g.events.building(b);
      } else g.removeBuilding(b);
    }
    // Ships on what is now dry ground are gone.
    for (const b of [...g.state.buildings])
      if (b.kind === "schiff" && !this.touchesWater(b) && this.inBasin(b))
        g.removeBuilding(b);
    if (ruins)
      g.events.news(
        ruins === 1
          ? "Aus dem Schlamm ragt eine Ruine."
          : `Aus dem Schlamm ragen ${ruins} Ruinen.`,
      );
    if (!this.any) g.events.news("Der Sihlsee ist leer.");
  }

  private inBasin(b: Building) {
    return this.isBasin(b.x, b.y);
  }

  private touchesWater(b: Building) {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++)
        if (this.g.isWater(x, y)) return true;
    return false;
  }

  /** Moves the wave on, destroys what it reaches, and ends it. */
  private runWave() {
    const g = this.g;
    const s = g.state;
    const wave = s.flood.wave ?? 0;
    const front = wave * balance.waveSpeed;
    if (front - this.bandLength > this.reachBack()) {
      s.flood.wave = null;
      this.front = -1;
      g.waysChanged(false);
      g.events.flood();
      g.events.news("Die Flutwelle ist vorbei. Die Sihl fliesst wieder ruhig.");
      return;
    }
    const before = this.front;
    this.front = front;
    if (before < 0) g.events.news("Die Flutwelle rollt die Sihl hinunter.");
    const lost: Building[] = [];
    for (const [id, d] of this.band ?? []) {
      if (d <= before || d > front) continue;
      const b = g.buildingAt(tileX(id), tileY(id));
      if (b && b.kind !== "damm" && !lost.includes(b)) lost.push(b);
    }
    for (const b of lost) g.removeBuilding(b);
    if (lost.length)
      g.events.news(
        lost.length === 1
          ? `Die Flutwelle hat ${g.nameOf(lost[0])} mitgerissen.`
          : `Die Flutwelle hat ${lost.length} Gebäude mitgerissen.`,
      );
    this.stepBack((x, y) => this.waved(x, y));
    g.waysChanged(true);
    g.events.flood();
  }

  /** Waldleute standing where the water is step back onto dry ground. */
  private stepBack(wet: (x: number, y: number) => boolean) {
    const g = this.g;
    for (const w of g.workers) {
      if (w.phase === "sail") continue;
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      if (!wet(tx, ty)) continue;
      g.idle(w);
      const dry = this.nearestDry(tx, ty, wet);
      w.x = dry.x + 0.5;
      w.y = dry.y + 0.5;
    }
  }

  private nearestDry(
    x: number,
    y: number,
    wet: (x: number, y: number) => boolean,
  ): { x: number; y: number } {
    for (let r = 1; r < 60; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx;
          const ty = y + dy;
          if (!wet(tx, ty) && this.g.open(tx, ty)) return { x: tx, y: ty };
        }
    return { x: damSite.x - 1, y: damSite.y + 1 };
  }
}
