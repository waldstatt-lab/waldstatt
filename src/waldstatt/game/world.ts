/**
 * The generated world: the same endless forest for every visitor, from a
 * fixed seed. North is up. The Alp and the Sihl come from the south and flow
 * together north of the first clearing; downstream only the Sihl goes on.
 * Upstream on the Sihl lie the narrow spot for the dam and the basin that
 * becomes the Sihlsee. Pure functions of the tile coordinates; only the
 * visitor's changes are saved.
 */

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

/** Where the Alp flows into the Sihl, in tile rows. */
export const confluenceY = -14;

/** Centre of the river below the confluence (north), in tiles. */
function downstreamX(y: number) {
  const d = confluenceY - y;
  return 2.4 * Math.sin(d / 15) + 1.6 * Math.sin(d / 6.5);
}

/** Centre of the Alp south of the confluence: south-west, then south. */
export function alpX(y: number) {
  const d = y - confluenceY;
  return (
    -15 * (1 - Math.exp(-d / 12)) + 1.6 * Math.sin(d / 9) * Math.min(1, d / 12)
  );
}

/** Centre of the Sihl south of the confluence: south-east, then south. */
export function sihlX(y: number) {
  const d = y - confluenceY;
  return (
    26 * (1 - Math.exp(-d / 22)) + 2.2 * Math.sin(d / 11) * Math.min(1, d / 12)
  );
}

const halfWidth = { downstream: 2.3, alp: 1.3, sihl: 1.8 };

/** Whether a tile is river water (the lake is separate). */
export function isRiver(tx: number, ty: number): boolean {
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  if (cy < confluenceY + 1) {
    return Math.abs(cx - downstreamX(cy)) < halfWidth.downstream;
  }
  return (
    Math.abs(cx - alpX(cy)) < halfWidth.alp ||
    Math.abs(cx - sihlX(cy)) < halfWidth.sihl
  );
}

/** The dam's fixed site: a narrow spot of the Sihl, upstream of the start. */
export const damY = 30;
export const damSite = (() => {
  const w = 7;
  return {
    x: Math.round(sihlX(damY + 1)) - Math.floor(w / 2),
    y: damY,
    w,
    h: 2,
  };
})();

const lakeLength = 60;

/** Whether a tile lies in the basin that the dam floods. */
export function isLakeBasin(tx: number, ty: number): boolean {
  const dy = ty + 0.5 - (damY + 2);
  if (dy < 0 || dy > lakeLength) return false;
  const t = dy / lakeLength;
  const opening = Math.min(1, t / 0.22);
  const hw = 1.8 + 21 * Math.pow(Math.sin(Math.PI * t), 1.2) * smooth(opening);
  const centre = sihlX(ty + 0.5) + 8 * Math.sin(Math.PI * t) * smooth(opening);
  const wobble = (noise(tx / 5, ty / 5, 7) - 0.5) * 7 * smooth(opening);
  return Math.abs(tx + 0.5 - centre) < hw + wobble;
}

/** All basin tiles, for the flood preview and the flood itself. */
export function lakeTiles(): [number, number][] {
  const tiles: [number, number][] = [];
  for (let ty = damY + 1; ty <= damY + 3 + lakeLength; ty++) {
    for (let tx = -10; tx <= 80; tx++) {
      if (isLakeBasin(tx, ty)) tiles.push([tx, ty]);
    }
  }
  return tiles;
}

/** The first clearing, where the first Waldmensch stands. */
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

/** 0–2 firs of different shades, 3 a broadleaf tree; firs dominate. */
export function treeVariant(tx: number, ty: number): number {
  const leafy = noise(tx / 14, ty / 14, 11) > 0.7 && hash(tx, ty, 4) < 0.45;
  if (leafy) return 3;
  return Math.floor(hash(tx, ty, 5) * 3);
}

/** A small offset per tree, in world units, so rows do not look planted. */
export function treeJitter(tx: number, ty: number): [number, number] {
  return [
    Math.round((hash(tx, ty, 8) - 0.5) * 6),
    Math.round((hash(tx, ty, 9) - 0.5) * 4),
  ];
}
