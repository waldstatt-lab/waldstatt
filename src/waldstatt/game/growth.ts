/**
 * The forest grows back. Felled ground beside standing forest grows a
 * seedling now and then, which grows into a tree. Nothing grows on cobbles,
 * water, buildings, graves or where Waldleute walked lately: seedlings there
 * are trodden down, so the ways stay open. Texts that are not cobbled sink
 * back under the trees, though a game whose scroll once lay free stays
 * explored. One chunk is looked at per step, in turn.
 */
import { balance, CHUNK } from "./config";
import { tileId } from "./nav";
import type { Game } from "./sim";

/** Growth bytes: 1 a fresh seedling, `full` a tree. */
export const full = 250;

export class Growth {
  /** When a Waldmensch last stood on a tile, in seconds of play. */
  private trodden = new Map<number, number>();
  private time = 0;
  /** Chunks still to look at in this round, and when each was last seen. */
  private queue: string[] = [];
  private seen = new Map<string, number>();

  constructor(private g: Game) {}

  /** A Waldmensch stands on a tile. */
  trod(x: number, y: number) {
    this.trodden.set(tileId(x, y), this.time);
    if (this.trodden.size > 200_000) {
      const old = this.time - balance.trodSeconds;
      for (const [id, t] of this.trodden) if (t < old) this.trodden.delete(id);
    }
  }

  private walked(x: number, y: number) {
    const t = this.trodden.get(tileId(x, y));
    return t !== undefined && this.time - t < balance.trodSeconds;
  }

  /** How far a seedling on a tile has grown, 0 to 1; 0 if none. */
  stage(x: number, y: number): number {
    const { chunk, index } = locate(x, y);
    const value = this.g.state.growth.get(chunk)?.[index] ?? 0;
    return value / full;
  }

  /** Takes a seedling away, e.g. under a new building or cobbles. */
  clear(x: number, y: number) {
    const { chunk, index } = locate(x, y);
    const bytes = this.g.state.growth.get(chunk);
    if (!bytes?.[index]) return;
    bytes[index] = 0;
    this.g.state.dirtyChunks.add(chunk);
    this.g.events.tree(x, y);
  }

  step(dt: number) {
    this.time += dt;
    if (!this.queue.length) this.queue = [...this.g.state.felled.keys()];
    const chunk = this.queue.pop();
    if (!chunk) return;
    const last = this.seen.get(chunk);
    this.seen.set(chunk, this.time);
    // The first look only starts the clock.
    if (last === undefined) return;
    this.grow(chunk, Math.min(30, this.time - last));
  }

  private grow(chunk: string, elapsed: number) {
    const g = this.g;
    const felled = g.state.felled.get(chunk);
    if (!felled) return;
    const [cx, cy] = chunk.split(",").map(Number);
    let bytes = g.state.growth.get(chunk);
    const sprout = elapsed / balance.sproutSeconds;
    const rise = (elapsed / balance.growSeconds) * full;
    let changed = false;
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      if (!(felled[i >> 3] & (1 << (i & 7)))) continue;
      const x = cx * CHUNK + (i % CHUNK);
      const y = cy * CHUNK + Math.floor(i / CHUNK);
      const value = bytes?.[i] ?? 0;
      if (!g.canGrow(x, y)) {
        if (value && bytes) {
          bytes[i] = 0;
          changed = true;
          g.events.tree(x, y);
        }
        continue;
      }
      const walked = this.walked(x, y);
      if (!value) {
        if (walked || Math.random() >= sprout) continue;
        if (this.forestAround(x, y) < 2) continue;
        bytes ??= this.bytes(chunk);
        bytes[i] = 1;
        changed = true;
        g.events.tree(x, y);
        continue;
      }
      if (!bytes) continue;
      const next = Math.min(full, value + rise);
      if (next >= full) {
        // Only on ground nobody walked on lately, and nobody stands on.
        if (walked || g.someoneOn(x, y)) {
          bytes[i] = full - 1;
        } else {
          bytes[i] = 0;
          g.regrow(x, y);
        }
        changed = true;
        continue;
      }
      const before = Math.floor((value / full) * 4);
      // Small steps add up on average: round up as often as the fraction says.
      const whole = Math.floor(next);
      bytes[i] = Math.max(1, whole + (Math.random() < next - whole ? 1 : 0));
      changed = true;
      if (Math.floor((bytes[i] / full) * 4) !== before) g.events.tree(x, y);
    }
    if (changed) {
      g.state.dirtyChunks.add(chunk);
      if (bytes && bytes.every((v) => v === 0)) g.state.growth.delete(chunk);
    }
  }

  private bytes(chunk: string): Uint8Array {
    const bytes = new Uint8Array(CHUNK * CHUNK);
    this.g.state.growth.set(chunk, bytes);
    return bytes;
  }

  private forestAround(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && this.g.isTree(x + dx, y + dy)) n++;
    return n;
  }
}

function locate(x: number, y: number) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  return {
    chunk: `${cx},${cy}`,
    index: (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK),
  };
}
