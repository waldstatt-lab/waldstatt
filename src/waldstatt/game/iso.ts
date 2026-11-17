/**
 * The projections between tiles and the screen. The map is usually seen in
 * the isometric view of classic strategy games: tiles are 2:1 diamonds, +x
 * runs down-right and +y down-left. To read a text lying on the ground, the
 * view turns into a top-down plan with north up. projection(t) blends the two;
 * world units are screen pixels at zoom 1. The art is painted for the
 * isometric view (iso()).
 */

/** Width and height of one tile diamond in the isometric view. */
export const TW = 64;
export const TH = 32;

/** A linear map: (x, y) → (a·x + c·y, b·x + d·y). */
export interface Linear {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Side of a tile in the top-down view, the same size as the diamond's edge. */
export const PLAN = TW / Math.SQRT2;

/** 0: the isometric view; 1: the top-down plan; between: turning. */
export function projection(t: number): Linear {
  const angle = (Math.PI / 4) * (1 - t);
  const squash = 0.5 + 0.5 * t;
  const cos = Math.cos(angle) * PLAN;
  const sin = Math.sin(angle) * PLAN;
  return { a: cos, b: sin * squash, c: -sin, d: cos * squash };
}

export function apply(m: Linear, x: number, y: number) {
  return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
}

export function invert(m: Linear, px: number, py: number) {
  const det = m.a * m.d - m.b * m.c;
  return {
    x: (m.d * px - m.c * py) / det,
    y: (-m.b * px + m.a * py) / det,
  };
}

/** World position of the tile corner (x, y) at height z, in the isometric view. */
export function iso(x: number, y: number, z = 0): { x: number; y: number } {
  return { x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - z };
}
