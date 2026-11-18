/**
 * What the theatre's previews share (stage.ts): a game runs a game's
 * simplified rules, plays a demonstration on its own and hands over when
 * somebody presses a key from the game's controls table or one of the
 * stage's wooden signs. Not the games themselves. Copied from the
 * studio website's previews and repainted as a stage set; nothing is imported from
 * there.
 */

import type { Painter } from "./art";

export interface Input {
  /** Actions whose key or on-screen key is held down. */
  held: Set<string>;
  /** Actions pressed since the last step. */
  pressed: Set<string>;
}

export interface Report {
  /** Shows a short line; while somebody plays, it is also announced. */
  say(text: string): void;
  /** Shows a value such as the number of saltos. */
  stat(name: string, value: string | number): void;
}

export interface Game {
  /** Size of the scene in its own units. */
  width: number;
  height: number;
  /** Lower-case `KeyboardEvent.key` → action. */
  keys: Record<string, string>;
  /** Advances by `dt` seconds; in a demonstration the game drives itself. */
  step(dt: number, input: Input, demo: boolean): void;
  /** Draws the scene; `scale` is canvas pixels per scene unit. */
  draw(ctx: CanvasRenderingContext2D, scale: number): void;
  /**
   * Paints the scene standing on the stage in the isometric view, in the
   * stage's tiles (u, v from its corner; the stage is w × h tiles) and world
   * units of height.
   */
  iso(P: Painter, w: number, h: number): void;
}

/** A thin circle standing upright along u at (u, v), radius r in world units. */
export function wheelPoints(
  P: Painter,
  u: number,
  v: number,
  z: number,
  r: number,
  unit: number,
): [number, number][] {
  return Array.from({ length: 18 }, (_, k) => {
    const a = (k / 18) * Math.PI * 2;
    return P.p(u + (Math.cos(a) * r) / unit, v, z + Math.sin(a) * r);
  });
}

/** Fills a closed outline given in screen points. */
export function fillOutline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  fill: string,
  line?: string,
  width = 1,
) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/**
 * The studio website draws these scenes in neon. On the stage they are painted
 * flat, so the glow only draws.
 */
export function glow(
  _ctx: CanvasRenderingContext2D,
  _scale: number,
  _color: string,
  _blur: number,
  draw: () => void,
) {
  draw();
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
