/**
 * The world: the same endless forest for every visitor, from a fixed seed,
 * and the real waters around Einsiedeln from swisstopo and BAFU data
 * (waters.ts). One tile is 50 m; tile (0, 0) is the Klosterplatz, north is
 * −y. The Sihlsee is a basin until the dam floods it; before, the Sihl and
 * its brooks run through the valley. Only the visitor's changes are saved.
 */
import { area, basin, dam, lakes, lines, type Lake } from "./waters";

/** Integer hash of a tile and a salt, as a number in [0, 1). */
export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (salt * 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1). */
export function noise(x: number, y: number, salt = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash(x0, y0, salt);
  const b = hash(x0 + 1, y0, salt);
  const c = hash(x0, y0 + 1, salt);
  const d = hash(x0 + 1, y0 + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Half widths in tiles: rivers are drawn wider than they are, brooks narrow. */
export const halfWidth = { river: 0.6, brook: 0.3 };

// The water grid over the data's area: bit 1 water, bit 2 the Sihlsee basin.
const gx0 = Math.floor(area.x0);
const gy0 = Math.floor(area.y0);
const gw = Math.ceil(area.x1) - gx0;
const gh = Math.ceil(area.y1) - gy0;
let grid: Uint8Array | null = null;

function fillRings(cells: Uint8Array, rings: number[][], bit: number) {
  const ys = rings.flatMap((ring) => ring.filter((_, i) => i % 2));
  const top = Math.max(gy0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(gy0 + gh - 1, Math.ceil(Math.max(...ys)));
  for (let ty = top; ty <= bottom; ty++) {
    const cy = ty + 0.5;
    const cuts: number[] = [];
    for (const ring of rings) {
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i * 2 + 1];
        const yj = ring[j * 2 + 1];
        if (yi > cy === yj > cy) continue;
        const xi = ring[i * 2];
        const xj = ring[j * 2];
        cuts.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
      }
    }
    cuts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const from = Math.max(gx0, Math.ceil(cuts[k] - 0.5));
      const to = Math.min(gx0 + gw - 1, Math.floor(cuts[k + 1] - 0.5));
      for (let tx = from; tx <= to; tx++)
        cells[(ty - gy0) * gw + tx - gx0] |= bit;
    }
  }
}

function strokeLine(cells: Uint8Array, points: number[], hw: number) {
  for (let i = 2; i < points.length; i += 2) {
    const [ax, ay, bx, by] = [
      points[i - 2],
      points[i - 1],
      points[i],
      points[i + 1],
    ];
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const x0 = Math.max(gx0, Math.floor(Math.min(ax, bx) - hw - 1));
    const x1 = Math.min(gx0 + gw - 1, Math.ceil(Math.max(ax, bx) + hw));
    const y0 = Math.max(gy0, Math.floor(Math.min(ay, by) - hw - 1));
    const y1 = Math.min(gy0 + gh - 1, Math.ceil(Math.max(ay, by) + hw));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const px = tx + 0.5;
        const py = ty + 0.5;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length2,
          ),
        );
        const d = Math.hypot(
          px - (ax + t * (bx - ax)),
          py - (ay + t * (by - ay)),
        );
        if (d < hw) cells[(ty - gy0) * gw + tx - gx0] |= 1;
      }
    }
  }
}

function cells(): Uint8Array {
  if (grid) return grid;
  grid = new Uint8Array(gw * gh);
  for (const lake of lakes) fillRings(grid, lake.rings, 1);
  fillRings(grid, basin.rings, 2);
  for (const line of lines)
    strokeLine(
      grid,
      line.points,
      line.wide ? halfWidth.river : halfWidth.brook,
    );
  return grid;
}

function cell(tx: number, ty: number): number {
  const x = tx - gx0;
  const y = ty - gy0;
  if (x < 0 || y < 0 || x >= gw || y >= gh) return 0;
  return cells()[y * gw + x];
}

/** Whether a tile is a river, a brook or a natural lake. */
export function isRiver(tx: number, ty: number): boolean {
  return (cell(tx, ty) & 1) !== 0;
}

/** Whether a tile lies in the basin that the dam floods. */
export function isLakeBasin(tx: number, ty: number): boolean {
  return (cell(tx, ty) & 2) !== 0;
}

/** All basin tiles, for the flood. */
export function lakeTiles(): [number, number][] {
  const tiles: [number, number][] = [];
  const all = cells();
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (all[y * gw + x] & 2) tiles.push([x + gx0, y + gy0]);
  return tiles;
}

/** The Sihlsee basin and the natural lakes, for drawing. */
export const waters: { lakes: Lake[]; basin: Lake } = { lakes, basin };

/** The dam's fixed site: where the Sihl leaves the basin at its north end. */
export const damSite = dam ?? { x: 0, y: -60, w: 6, h: 2 };

/** The first clearing at the Klosterplatz, where the first Waldmensch stands. */
export const start = { x: 0, y: 0 };
const startRadius = 2.7;

/** Whether the generated forest has a tree on this tile. */
export function hasBaseTree(tx: number, ty: number): boolean {
  if (isRiver(tx, ty)) return false;
  const dx = tx + 0.5 - (start.x + 0.5);
  const dy = ty + 0.5 - (start.y + 0.5);
  if (dx * dx + dy * dy < startRadius * startRadius) return false;
  // A few gaps keep the forest from looking like a carpet.
  return hash(tx, ty, 1) < 0.95 - noise(tx / 9, ty / 9, 3) * 0.08;
}

/** 0–3 firs of different shades, 4–5 broadleaf trees; firs dominate. */
export function treeVariant(tx: number, ty: number): number {
  const leafy = noise(tx / 14, ty / 14, 11) > 0.74 && hash(tx, ty, 4) < 0.45;
  if (leafy) return 4 + (hash(tx, ty, 6) < 0.5 ? 0 : 1);
  return Math.floor(hash(tx, ty, 5) * 4);
}

/** A small offset per tree, in world units, so rows do not look planted. */
export function treeJitter(tx: number, ty: number): [number, number] {
  return [
    Math.round((hash(tx, ty, 8) - 0.5) * 6),
    Math.round((hash(tx, ty, 9) - 0.5) * 4),
  ];
}
