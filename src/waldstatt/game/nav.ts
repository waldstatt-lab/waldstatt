/**
 * Finding ways. Waldleute walk only on open ground: felled forest, natural
 * gaps, bridges and the finished dam, never through standing trees or water.
 * Between the ports of one lake they cross by ship. Ships sail only on the
 * water of their own lake. Both search the tile grid with eight neighbours and
 * never cut past a corner, then straighten the way where the straight line
 * stays clear. No rendering and no DOM here.
 */

const offset = 1 << 20;
const span = 1 << 21;

/** One number per tile, for fast maps and sets; tiles within ±1 million. */
export const tileId = (x: number, y: number) =>
  (x + offset) * span + (y + offset);
export const tileX = (id: number) => Math.floor(id / span) - offset;
export const tileY = (id: number) => (id % span) - offset;

export interface Point {
  x: number;
  y: number;
}

/** A crossing by ship from one port's quay to another's. */
export interface Ferry {
  /** The landing quay's tile. */
  to: number;
  /** Where the Waldmensch steps ashore. */
  x: number;
  y: number;
  /** The crossing's cost in tiles walked. */
  cost: number;
  /** The two ports. */
  from: number;
  port: number;
}

export interface Ways {
  open(x: number, y: number): boolean;
  /** The crossings that leave from this tile, if it is a quay. */
  ferries(id: number): Ferry[] | undefined;
}

export interface Found<T> {
  value: T;
  /** Tiles from the start to the goal. */
  path: number[];
  /** The tiles reached by ship, and the crossing that reached them. */
  via: Map<number, Ferry>;
}

const steps: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** A binary min-heap of tiles by cost. */
class Heap {
  private costs: number[] = [];
  private ids: number[] = [];

  get size() {
    return this.costs.length;
  }

  push(cost: number, id: number) {
    const c = this.costs;
    const d = this.ids;
    let i = c.length;
    c.push(cost);
    d.push(id);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (c[parent] <= cost) break;
      c[i] = c[parent];
      d[i] = d[parent];
      i = parent;
    }
    c[i] = cost;
    d[i] = id;
  }

  pop(): [number, number] {
    const c = this.costs;
    const d = this.ids;
    const top: [number, number] = [c[0], d[0]];
    const lastCost = c.pop() as number;
    const lastId = d.pop() as number;
    if (c.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= c.length) break;
        const r = l + 1;
        const m = r < c.length && c[r] < c[l] ? r : l;
        if (c[m] >= lastCost) break;
        c[i] = c[m];
        d[i] = d[m];
        i = m;
      }
      c[i] = lastCost;
      d[i] = lastId;
    }
    return top;
  }
}

/** A search reaches this many tiles from its start in each direction. */
const reach = 256;
const side = reach * 2;

/** Arrays reused by every search; a generation stamp marks what is current. */
let scratch: {
  generation: number;
  stamp: Uint32Array;
  cost: Float64Array;
  parent: Int32Array;
  openStamp: Uint32Array;
  open: Uint8Array;
} | null = null;

function arrays() {
  if (!scratch || scratch.generation >= 0xfffffff0) {
    const n = side * side;
    scratch = {
      generation: 0,
      stamp: new Uint32Array(n),
      cost: new Float64Array(n),
      parent: new Int32Array(n),
      openStamp: new Uint32Array(n),
      open: new Uint8Array(n),
    };
  }
  scratch.generation++;
  return scratch;
}

/**
 * Searches outward from (sx, sy), cheapest first, for the goal with the
 * lowest cost plus bias, within `reach` tiles. `goal` tells for a reached
 * tile whether work waits there and its bias, and gets the search's own
 * `open`, which asks the ways once per tile; `minBias` is the lowest bias it
 * returns, so the search stops once nothing better can come. The start tile
 * may be closed: a Waldmensch can always step off it. If nothing is found,
 * `searched` gets every tile the search reached.
 */
export function search<T>(
  ways: Ways,
  sx: number,
  sy: number,
  goal: (
    x: number,
    y: number,
    open: (x: number, y: number) => boolean,
  ) => { bias: number; value: T } | undefined,
  minBias: number,
  limit: number,
  searched?: Set<number>,
): Found<T> | undefined {
  const m = arrays();
  const gen = m.generation;
  const ox = sx - reach;
  const oy = sy - reach;
  const index = (x: number, y: number) => {
    const lx = x - ox;
    const ly = y - oy;
    return lx < 0 || ly < 0 || lx >= side || ly >= side ? -1 : ly * side + lx;
  };
  const open = (x: number, y: number) => {
    const i = index(x, y);
    if (i < 0) return false;
    if (m.openStamp[i] !== gen) {
      m.openStamp[i] = gen;
      m.open[i] = ways.open(x, y) ? 1 : 0;
    }
    return m.open[i] === 1;
  };
  const via = new Map<number, Ferry>();
  const heap = new Heap();
  const settledTiles: number[] = [];
  const visit = (i: number, c: number, from: number, ferry?: Ferry) => {
    if (m.stamp[i] === gen && c >= m.cost[i]) return;
    m.stamp[i] = gen;
    m.cost[i] = c;
    m.parent[i] = from;
    if (ferry) via.set(i, ferry);
    else via.delete(i);
    heap.push(c, i);
  };
  visit(index(sx, sy), 0, -1);
  let best: { score: number; i: number; value: T } | undefined;
  while (heap.size) {
    const [c, i] = heap.pop();
    if (c > m.cost[i]) continue;
    if (best && c + minBias >= best.score) break;
    if (settledTiles.length >= limit) break;
    settledTiles.push(i);
    const x = ox + (i % side);
    const y = oy + Math.floor(i / side);
    const found = goal(x, y, open);
    if (found && (!best || c + found.bias < best.score))
      best = { score: c + found.bias, i, value: found.value };
    for (const [dx, dy, step] of steps) {
      if (!open(x + dx, y + dy)) continue;
      if (dx && dy && (!open(x + dx, y) || !open(x, y + dy))) continue;
      visit(i + dy * side + dx, c + step, i);
    }
    for (const ferry of ways.ferries(tileId(x, y)) ?? []) {
      const to = index(tileX(ferry.to), tileY(ferry.to));
      if (to >= 0) visit(to, c + ferry.cost, i, ferry);
    }
  }
  const id = (i: number) => tileId(ox + (i % side), oy + Math.floor(i / side));
  if (!best) {
    if (searched) for (const i of settledTiles) searched.add(id(i));
    return undefined;
  }
  const path: number[] = [];
  const reachedBy = new Map<number, Ferry>();
  for (let at = best.i; at >= 0; at = m.parent[at]) {
    path.push(id(at));
    const ferry = via.get(at);
    if (ferry) reachedBy.set(id(at), ferry);
  }
  path.reverse();
  return { value: best.value, path, via: reachedBy };
}

/**
 * Whether the straight line from a to b stays on open tiles, without slipping
 * diagonally between two closed ones. The tile a starts on is not checked.
 */
export function clearLine(
  open: (x: number, y: number) => boolean,
  a: Point,
  b: Point,
): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2);
  let px = Math.floor(a.x);
  let py = Math.floor(a.y);
  const sx = px;
  const sy = py;
  for (let i = 1; i <= n; i++) {
    const tx = Math.floor(a.x + ((b.x - a.x) * i) / n);
    const ty = Math.floor(a.y + ((b.y - a.y) * i) / n);
    if (tx === px && ty === py) continue;
    if (!(tx === sx && ty === sy) && !open(tx, ty)) return false;
    if (tx !== px && ty !== py && (!open(tx, py) || !open(px, ty)))
      return false;
    px = tx;
    py = ty;
  }
  return true;
}

/** Drops the corners that a straight line can skip. */
export function straighten(
  points: Point[],
  clear: (a: Point, b: Point) => boolean,
): Point[] {
  if (points.length <= 2) return points;
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    // Look ahead a bounded stretch, so long ways stay cheap.
    while (
      j + 1 < points.length &&
      j - i < 48 &&
      clear(points[i], points[j + 1])
    )
      j++;
    out.push(points[j]);
    i = j;
  }
  return out;
}

/**
 * A ship's way over open water from one point to another, as points after
 * the start. Falls back to the straight line if no way is found.
 */
export function waterRoute(
  water: (x: number, y: number) => boolean,
  from: Point,
  to: Point,
  limit = 300_000,
): Point[] {
  const start = tileId(Math.floor(from.x), Math.floor(from.y));
  const end = tileId(Math.floor(to.x), Math.floor(to.y));
  if (start === end) return [to];
  const parent = new Map<number, number>([[start, start]]);
  const queue = [start];
  for (let head = 0; head < queue.length && head < limit; head++) {
    const id = queue[head];
    if (id === end) break;
    const x = tileX(id);
    const y = tileY(id);
    for (const [dx, dy] of steps) {
      const next = tileId(x + dx, y + dy);
      if (parent.has(next) || !water(x + dx, y + dy)) continue;
      if (dx && dy && (!water(x + dx, y) || !water(x, y + dy))) continue;
      parent.set(next, id);
      queue.push(next);
    }
  }
  if (!parent.has(end)) return [to];
  const tiles: Point[] = [];
  for (let at = end; at !== start; at = parent.get(at) as number)
    tiles.push({ x: tileX(at) + 0.5, y: tileY(at) + 0.5 });
  tiles.reverse();
  tiles[tiles.length - 1] = to;
  const way = straighten([from, ...tiles], (a, b) => clearLine(water, a, b));
  return way.slice(1);
}
