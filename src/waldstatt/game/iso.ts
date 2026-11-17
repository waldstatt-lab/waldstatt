/**
 * The isometric projection: tiles are 2:1 diamonds, as in classic strategy
 * games. Tile coordinates keep north as −y; on screen, +x runs down-right and
 * +y down-left. World units are screen pixels at zoom 1.
 */

/** Width and height of one tile diamond. */
export const TW = 64;
export const TH = 32;

/** World position of the tile corner (x, y), at height z. */
export function iso(x: number, y: number, z = 0): { x: number; y: number } {
  return { x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - z };
}

/** Tile coordinates (fractional) of a world position on the ground. */
export function fromIso(px: number, py: number): { x: number; y: number } {
  return { x: py / TH + px / TW, y: py / TH - px / TW };
}

/** The four corners of a tile rectangle on the ground, clockwise from the top. */
export function diamond(x: number, y: number, w = 1, h = 1): number[] {
  const a = iso(x, y);
  const b = iso(x + w, y);
  const c = iso(x + w, y + h);
  const d = iso(x, y + h);
  return [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
}
