/**
 * The theatre's previews (Theater-Bühne in Game.astro): a small canvas that
 * runs a game's simplified rules, plays a demonstration on its own and hands
 * over when somebody presses a key from the game's controls table or one of
 * the on-screen keys. Not the games themselves. Copied from the studio website's
 * previews and repainted as a stage set; nothing is imported from there.
 *
 * Keys are handled only while the preview has focus. The loop runs only while
 * the preview is on screen. There is no demonstration with reduced motion;
 * the preview then moves only while somebody plays. Nothing is stored or sent.
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
  /** Writes a value into the element marked `data-stat="<name>"`. */
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

/** After this long without input, the demonstration takes over again. */
const idleMs = 8000;

/** Starts a preview; returns false without a 2D canvas. */
export function mountPreview(
  section: HTMLElement,
  create: (report: Report) => Game,
): boolean {
  const canvas = section.querySelector<HTMLCanvasElement>("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return false;
  const ctx = context;
  const surface = canvas;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const demoAllowed = () => !still.matches;
  const status = section.querySelector<HTMLElement>("[data-preview-status]");
  const live = section.querySelector<HTMLElement>("[data-preview-live]");
  const mode = section.querySelector<HTMLElement>("[data-preview-mode]");
  const input: Input = { held: new Set(), pressed: new Set() };
  let demo = demoAllowed();
  let lastInput = -Infinity;
  let visible = false;
  let frame = 0;
  let last = 0;
  let scale = 1;

  const report: Report = {
    say(text) {
      if (status) status.textContent = text;
      if (live && !demo) live.textContent = text;
    },
    stat(name, value) {
      const element = section.querySelector(`[data-stat="${name}"]`);
      if (element) element.textContent = String(value);
    },
  };
  const game = create(report);
  surface.style.aspectRatio = `${game.width} / ${game.height}`;

  function setMode(isDemo: boolean) {
    demo = isDemo;
    section.dataset.mode = isDemo ? "demo" : "manual";
    if (mode)
      mode.textContent = isDemo
        ? (section.dataset.labelDemo ?? "")
        : (section.dataset.labelManual ?? "");
  }

  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    game.draw(ctx, scale);
  }

  function tick(time: number) {
    frame = 0;
    // About 30 frames per second are plenty for these small scenes.
    if (last && time - last < 1000 / 32) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 30;
    last = time;
    if (!demo && time - lastInput > idleMs && input.held.size === 0)
      setMode(demoAllowed());
    game.step(dt, input, demo);
    input.pressed.clear();
    paint();
    const playing = demo || time - lastInput < idleMs || input.held.size > 0;
    if (visible && !document.hidden && playing)
      frame = requestAnimationFrame(tick);
    else last = 0;
  }
  const run = () => {
    if (!frame && visible && !document.hidden)
      frame = requestAnimationFrame(tick);
  };

  const key = (action: string) =>
    section.querySelector(`[data-action="${action}"]`);
  function press(action: string) {
    if (!input.held.has(action)) input.pressed.add(action);
    input.held.add(action);
    lastInput = performance.now();
    if (demo) setMode(false);
    key(action)?.classList.add("is-pressed");
    run();
  }
  function release(action: string) {
    input.held.delete(action);
    key(action)?.classList.remove("is-pressed");
  }

  section.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      section.blur();
      return;
    }
    const action = game.keys[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    if (!event.repeat) press(action);
  });
  section.addEventListener("keyup", (event) => {
    const action = game.keys[event.key.toLowerCase()];
    if (action) release(action);
  });
  section.addEventListener("focusout", () => {
    for (const action of [...input.held]) release(action);
  });
  // The on-screen keys work by pointer and touch, held while pressed.
  for (const button of section.querySelectorAll<HTMLElement>("[data-action]")) {
    const action = button.dataset.action ?? "";
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      section.focus({ preventScroll: true });
      button.setPointerCapture(event.pointerId);
      press(action);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, () => release(action));
  }
  surface.addEventListener("pointerdown", () =>
    section.focus({ preventScroll: true }),
  );

  // Sharp at any size: the canvas matches its CSS size in device pixels.
  new ResizeObserver(() => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(surface.clientWidth * ratio));
    surface.width = width;
    surface.height = Math.round((width * game.height) / game.width);
    scale = width / game.width;
    paint();
  }).observe(surface);
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    run();
  }).observe(section);
  document.addEventListener("visibilitychange", run);
  const followSettings = () => {
    if (demo && !demoAllowed()) setMode(false);
    else if (!demo && demoAllowed() && input.held.size === 0)
      setMode(performance.now() - lastInput > idleMs);
    run();
  };
  still.addEventListener("change", followSettings);

  setMode(demo);
  // The first picture appears even when nothing moves.
  game.step(0, input, false);
  paint();
  return true;
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
