/**
 * What the theatre's previews share (stage.ts): a game runs a game's
 * simplified rules, plays a demonstration on its own and hands over when
 * somebody presses a key from the game's controls table or one of the
 * stage's wooden signs. Not the games themselves. Copied from the
 * studio website's previews and repainted as a stage set; nothing is imported from
 * there.
 */

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
