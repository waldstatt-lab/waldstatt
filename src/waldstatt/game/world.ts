/**
 * The world: the same endless forest for every visitor, from a fixed seed,
 * and the real waters of Switzerland from swisstopo's swissTLM3D, with the
 * national border as a wooden palisade (waters.ts, and a page of data per
 * 10 km square, loaded as it comes into view). One tile is 50 m; tile (0, 0)
 * is the Klosterplatz, north is −y; the first clearing lies at Holzrüti,
 * north of the village. Beyond the border lies the land abroad, without
 * forest, which nobody enters. The Sihlsee is a basin until the dam floods
 * it; before, the Sihl and its brooks run through the valley. Only the
 * visitor's changes are saved.
 */
import { href } from "../../lib/url";
import {
  basin,
  dam,
  PAGE,
  pageKinds,
  type Lake,
  type WaterPage,
} from "./waters";

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

/**
 * Water tiles lie within this distance of a river's line; at least half a
 * tile, so even a brook is an unbroken line of water that nobody slips
 * through. The palisade is as thick.
 */
const barrier = 0.5;

// Tile flags: water, a natural lake, the palisade, abroad. The Sihlsee's
// basin is kept whole (inBasin).
const WATER = 1;
const LAKE = 4;
const WALL = 8;
const ABROAD = 16;

/** Fills even-odd rings into a grid of w × h tiles whose corner is (x0, y0). */
function fillRings(
  rings: number[][],
  x0: number,
  y0: number,
  w: number,
  h: number,
  set: (i: number) => void,
) {
  if (!rings.length) return;
  const ys = rings.flatMap((ring) => ring.filter((_, i) => i % 2));
  const top = Math.max(y0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(y0 + h - 1, Math.ceil(Math.max(...ys)));
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
      const from = Math.max(x0, Math.ceil(cuts[k] - 0.5));
      const to = Math.min(x0 + w - 1, Math.floor(cuts[k + 1] - 0.5));
      for (let tx = from; tx <= to; tx++) set((ty - y0) * w + tx - x0);
    }
  }
}

/** Sets every tile of the grid within hw of a line. */
function strokeLine(
  points: number[],
  hw: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  set: (i: number) => void,
) {
  for (let i = 2; i < points.length; i += 2) {
    const [ax, ay, bx, by] = [
      points[i - 2],
      points[i - 1],
      points[i],
      points[i + 1],
    ];
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const fx = Math.max(x0, Math.floor(Math.min(ax, bx) - hw - 1));
    const tx1 = Math.min(x0 + w - 1, Math.ceil(Math.max(ax, bx) + hw));
    const fy = Math.max(y0, Math.floor(Math.min(ay, by) - hw - 1));
    const ty1 = Math.min(y0 + h - 1, Math.ceil(Math.max(ay, by) + hw));
    for (let ty = fy; ty <= ty1; ty++) {
      for (let tx = fx; tx <= tx1; tx++) {
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
        if (d < hw) set((ty - y0) * w + tx - x0);
      }
    }
  }
}

// --- The Sihlsee's basin, small enough to keep whole ----------------------

const basinBox = (() => {
  const xs = basin.rings.flatMap((r) => r.filter((_, i) => i % 2 === 0));
  const ys = basin.rings.flatMap((r) => r.filter((_, i) => i % 2 === 1));
  const x0 = Math.floor(Math.min(...xs));
  const y0 = Math.floor(Math.min(...ys));
  return {
    x0,
    y0,
    w: Math.ceil(Math.max(...xs)) - x0 + 1,
    h: Math.ceil(Math.max(...ys)) - y0 + 1,
  };
})();
let basinCells: Uint8Array | null = null;

function inBasin(tx: number, ty: number): boolean {
  const b = basinBox;
  const x = tx - b.x0;
  const y = ty - b.y0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  if (!basinCells) {
    const cells = new Uint8Array(b.w * b.h);
    fillRings(basin.rings, b.x0, b.y0, b.w, b.h, (i) => (cells[i] = 1));
    basinCells = cells;
  }
  return basinCells[y * b.w + x] === 1;
}

/** All basin tiles, for the flood. */
export function lakeTiles(): [number, number][] {
  const tiles: [number, number][] = [];
  const b = basinBox;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      if (inBasin(x + b.x0, y + b.y0)) tiles.push([x + b.x0, y + b.y0]);
  return tiles;
}

/** The Sihlsee's basin, for drawing. */
export const sihlsee: Lake = basin;
/** The lake number the dammed Sihlsee takes for ships. */
const sihlseeLake = 0xffff;

// --- Pages of water, loaded as they come into view --------------------------

/** A page of water data, rasterized into tiles once it arrived. */
export interface LoadedPage {
  px: number;
  py: number;
  data: WaterPage | null;
  flags: Uint8Array | null;
  /** Which natural lake each tile belongs to, 0 for none. */
  lakes: Uint16Array | null;
  /** The whole page lies abroad. */
  abroad: boolean;
}

const loaded = new Map<string, LoadedPage>();
const loading = new Map<string, Promise<void>>();
const listeners: ((page: LoadedPage) => void)[] = [];
let active = 0;
const queue: (() => void)[] = [];

export const pageOf = (t: number) => Math.floor(t / PAGE);
const pageKey = (px: number, py: number) => `${px},${py}`;

/** Calls back whenever a page has arrived, to draw it and find new ways. */
export function onPage(listener: (page: LoadedPage) => void) {
  listeners.push(listener);
}

/** The pages already here. */
export function loadedPages(): LoadedPage[] {
  return [...loaded.values()];
}

function rasterize(px: number, py: number, data: WaterPage): LoadedPage {
  const x0 = px * PAGE;
  const y0 = py * PAGE;
  const flags = new Uint8Array(PAGE * PAGE);
  let lakes: Uint16Array | null = null;
  if (data.land) {
    // Abroad is everything outside Switzerland's rings.
    flags.fill(ABROAD);
    fillRings(data.land, x0, y0, PAGE, PAGE, (i) => (flags[i] = 0));
  }
  for (const lake of data.lakes) {
    lakes ??= new Uint16Array(PAGE * PAGE);
    const ids = lakes;
    fillRings([...lake.rings, ...lake.islands], x0, y0, PAGE, PAGE, (i) => {
      flags[i] |= WATER | LAKE;
      ids[i] = lake.id;
    });
  }
  for (const line of data.lines)
    strokeLine(
      line.points,
      Math.max(barrier, line.wide ? halfWidth.river : halfWidth.brook),
      x0,
      y0,
      PAGE,
      PAGE,
      (i) => (flags[i] |= WATER),
    );
  for (const line of data.border)
    strokeLine(line, barrier, x0, y0, PAGE, PAGE, (i) => {
      // Where the border runs through water, the water stays.
      if (!(flags[i] & WATER)) flags[i] = WALL;
    });
  return { px, py, data, flags, lakes, abroad: false };
}

function arrive(page: LoadedPage) {
  loaded.set(pageKey(page.px, page.py), page);
  for (const listener of listeners) listener(page);
}

function next() {
  while (active < 4 && queue.length) {
    active++;
    (queue.shift() as () => void)();
  }
}

/** Loads one page; pages without a file are known at once. */
function loadPage(px: number, py: number): Promise<void> {
  const key = pageKey(px, py);
  if (loaded.has(key)) return Promise.resolve();
  const pending = loading.get(key);
  if (pending) return pending;
  const kind = pageKinds.get(key);
  if (kind !== "data") {
    // Wholly abroad, or wholly in Switzerland without water.
    arrive({
      px,
      py,
      data: null,
      flags: null,
      lakes: null,
      abroad: kind === undefined,
    });
    return Promise.resolve();
  }
  const promise = new Promise<void>((resolve) => {
    queue.push(() => {
      fetch(href(`/waters/${px}_${py}.json`))
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<WaterPage>;
        })
        .then((data) => arrive(rasterize(px, py, data)))
        .catch(() => {
          // Offline before this page was ever seen: try again later.
        })
        .finally(() => {
          loading.delete(key);
          active--;
          resolve();
          next();
        });
    });
    next();
  });
  loading.set(key, promise);
  return promise;
}

/** Asks for the pages covering a rectangle of tiles; true if all are here. */
export function needPages(x0: number, y0: number, x1: number, y1: number) {
  let ready = true;
  for (let py = pageOf(y0); py <= pageOf(y1); py++)
    for (let px = pageOf(x0); px <= pageOf(x1); px++) {
      if (loaded.has(pageKey(px, py))) continue;
      ready = false;
      void loadPage(px, py);
    }
  return ready;
}

/** Loads the pages covering a rectangle of tiles. */
export async function loadPages(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const all: Promise<void>[] = [];
  for (let py = pageOf(y0); py <= pageOf(y1); py++)
    for (let px = pageOf(x0); px <= pageOf(x1); px++)
      all.push(loadPage(px, py));
  await Promise.all(all);
}

/** Whether the water of this tile is known yet. */
export function isKnown(tx: number, ty: number): boolean {
  return loaded.has(pageKey(pageOf(tx), pageOf(ty)));
}

function flagsAt(tx: number, ty: number): number {
  const px = pageOf(tx);
  const py = pageOf(ty);
  const page = loaded.get(pageKey(px, py));
  if (!page) return 0;
  if (page.abroad) return ABROAD;
  if (!page.flags) return 0;
  return page.flags[(ty - py * PAGE) * PAGE + tx - px * PAGE];
}

/** Whether a tile is a river, a brook or a natural lake. */
export function isRiver(tx: number, ty: number): boolean {
  return (flagsAt(tx, ty) & WATER) !== 0;
}

/** Whether a tile is part of a natural lake. */
export function isNaturalLake(tx: number, ty: number): boolean {
  return (flagsAt(tx, ty) & LAKE) !== 0;
}

/** Whether a tile lies in the basin that the dam floods. */
export function isLakeBasin(tx: number, ty: number): boolean {
  return inBasin(tx, ty);
}

/** Whether the palisade along the border stands on this tile. */
export function isWall(tx: number, ty: number): boolean {
  return (flagsAt(tx, ty) & WALL) !== 0;
}

/** Whether a tile lies abroad, beyond the palisade. */
export function isAbroad(tx: number, ty: number): boolean {
  return (flagsAt(tx, ty) & ABROAD) !== 0;
}

/**
 * Which lake's water a tile is, so ships know which ports they can reach:
 * a natural lake's number, or the Sihlsee's once flooded; 0 for none.
 */
export function lakeAt(tx: number, ty: number, flooded: boolean): number {
  if (flooded && inBasin(tx, ty)) return sihlseeLake;
  const px = pageOf(tx);
  const py = pageOf(ty);
  const page = loaded.get(pageKey(px, py));
  if (!page?.lakes) return 0;
  return page.lakes[(ty - py * PAGE) * PAGE + tx - px * PAGE];
}

/** The dam's fixed site: where the Sihl leaves the basin at its north end. */
export const damSite = dam ?? { x: 0, y: -60, w: 6, h: 2 };

/**
 * The first clearing, where the first Waldmensch stands and the axe lies: at
 * ISE AG, Holzrüti 2, Einsiedeln (LV95 2699524 / 1222155, from the federal
 * building register), on the Alp's west bank, 1.8 km north of the Klosterplatz.
 */
export const start = { x: -3, y: -37 };
/** The Klosterplatz: the heart of Einsiedeln, tile (0, 0). */
export const town = { x: 0, y: 0 };
const startRadius = 2.7;

/** Whether the generated forest has a tree on this tile. */
export function hasBaseTree(tx: number, ty: number): boolean {
  // Unknown ground counts as forest, so nobody walks into it.
  if (!isKnown(tx, ty)) return true;
  const flags = flagsAt(tx, ty);
  if (flags & (WATER | WALL | ABROAD)) return false;
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
