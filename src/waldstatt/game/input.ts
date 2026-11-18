/**
 * Pointer, touch, wheel and keyboard input on the map. Dragging pans (with
 * the saw, one finger or the left mouse button marks an area instead, and two
 * fingers or another mouse button pan; while placing, a drag that starts on
 * the building being placed moves it); pinching and the wheel zoom; a tap is
 * a short press without movement. Keys are handled only while the map has
 * focus: arrows or h j k l move the cursor one tile along the squares'
 * edges, again and again while held, and the view glides after it; with
 * Shift they pan smoothly; + and − zoom; v starts a rectangle (the saw's or
 * paving's) at the cursor; Enter or Space applies; Escape cancels.
 */
import type { Renderer } from "./render";

export interface Tile {
  x: number;
  y: number;
}

export interface MapHandlers {
  /** A press at an exact tile position, e.g. on a stage's sign; true if taken. */
  press(at: { x: number; y: number }): boolean;
  /** The press ended. */
  release(): void;
  /** A key for something on the map, such as the stage; true if taken. */
  key(event: KeyboardEvent, down: boolean): boolean;
  /** Whether a one-finger or left-button drag marks an area (the saw). */
  sawing(): boolean;
  /** A press on the building being placed: true if it is taken to drag. */
  grab(tile: Tile): boolean;
  /** The building being placed is dragged over a tile. */
  drag(tile: Tile): void;
  tap(tile: Tile, pointer: string): void;
  hover(tile: Tile): void;
  saw(from: Tile, to: Tile, done: boolean): void;
  cursor(tile: Tile): void;
  activate(tile: Tile): void;
  /** v: a rectangle starts at the cursor, for the saw or paving. */
  visual(tile: Tile): void;
  cancel(): void;
  /** The view moved, e.g. to save the camera. */
  moved(): void;
}

const tapSlop = 8;

export function attachInput(
  host: HTMLElement,
  renderer: Renderer,
  handlers: MapHandlers,
) {
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number; time: number; id: number } | null = null;
  let moved = false;
  let sawFrom: Tile | null = null;
  let pinch = 0;
  let cursor: Tile | null = null;
  /** A press taken by something on the map, held until the pointer lifts. */
  let pressing = false;
  /** The building being placed is held and follows the pointer. */
  let grabbing = false;

  const local = (event: PointerEvent | WheelEvent) => {
    const box = host.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const tileAt = (point: { x: number; y: number }): Tile => {
    const t = renderer.screenToTile(point.x, point.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  host.addEventListener("pointerdown", (event) => {
    host.focus({ preventScroll: true });
    const point = local(event);
    // The cursor tile is for the keyboard; a pointer hides it.
    if (cursor) {
      cursor = null;
      renderer.setCursor(null);
    }
    pointers.set(event.pointerId, point);
    host.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      if (handlers.press(renderer.screenToTile(point.x, point.y))) {
        pressing = true;
        return;
      }
      downAt = { ...point, time: performance.now(), id: event.pointerId };
      moved = false;
      grabbing =
        (event.pointerType !== "mouse" || event.button === 0) &&
        handlers.grab(tileAt(point));
      if (grabbing) return;
      const marks =
        handlers.sawing() &&
        (event.pointerType !== "mouse" || event.button === 0);
      sawFrom = marks ? tileAt(point) : null;
      if (sawFrom) handlers.saw(sawFrom, sawFrom, false);
    } else {
      // A second finger: pinch and pan instead of sawing or tapping.
      if (sawFrom) handlers.saw(sawFrom, sawFrom, false);
      sawFrom = null;
      moved = true;
      pinch = spread();
    }
  });

  host.addEventListener("pointermove", (event) => {
    const point = local(event);
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === "mouse") handlers.hover(tileAt(point));
      return;
    }
    pointers.set(event.pointerId, point);
    if (pressing) return;
    if (downAt && Math.hypot(point.x - downAt.x, point.y - downAt.y) > tapSlop)
      moved = true;
    if (grabbing && pointers.size === 1) {
      handlers.drag(tileAt(point));
      return;
    }
    if (pointers.size >= 2) {
      grabbing = false;
      const now = spread();
      if (pinch && now) {
        const [a, b] = [...pointers.values()];
        renderer.zoomAt(now / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      pinch = now;
      renderer.pan((point.x - previous.x) / 2, (point.y - previous.y) / 2);
      return;
    }
    if (sawFrom) {
      handlers.saw(sawFrom, tileAt(point), false);
      return;
    }
    if (moved) renderer.pan(point.x - previous.x, point.y - previous.y);
    if (event.pointerType === "mouse") handlers.hover(tileAt(point));
  });

  const end = (event: PointerEvent, cancelled: boolean) => {
    if (!pointers.has(event.pointerId)) return;
    if (pressing) {
      pointers.delete(event.pointerId);
      pressing = false;
      handlers.release();
      return;
    }
    const point = local(event);
    pointers.delete(event.pointerId);
    if (pointers.size > 0) {
      pinch = spread();
      return;
    }
    if (grabbing) {
      grabbing = false;
      // A press on it without a drag is a tap: with a mouse, it builds.
      if (!cancelled && !moved) handlers.tap(tileAt(point), event.pointerType);
    } else if (sawFrom) {
      if (!cancelled) handlers.saw(sawFrom, tileAt(point), true);
      sawFrom = null;
    } else if (!cancelled && !moved && downAt?.id === event.pointerId) {
      handlers.tap(tileAt(point), event.pointerType);
    }
    if (moved) handlers.moved();
    downAt = null;
  };
  host.addEventListener("pointerup", (event) => end(event, false));
  host.addEventListener("pointercancel", (event) => end(event, true));

  host.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = local(event);
      const factor = Math.exp(
        -Math.max(-60, Math.min(60, event.deltaY)) * 0.004,
      );
      renderer.zoomAt(factor, point.x, point.y);
      handlers.moved();
    },
    { passive: false },
  );

  const centreTile = (): Tile => {
    const box = host.getBoundingClientRect();
    return tileAt({ x: box.width / 2, y: box.height / 2 });
  };

  host.addEventListener("focus", () => {
    // The cursor appears only for keyboard use.
    if (host.matches(":focus-visible")) {
      cursor ??= centreTile();
      handlers.cursor(cursor);
    }
  });

  /** The steps along the tiles, by key; with Shift, the directions to pan on screen. */
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    h: [-1, 0],
    l: [1, 0],
    k: [0, -1],
    j: [0, 1],
  };
  /** The keys held to move the cursor or pan, and since when. */
  const held = new Map<string, { pan: boolean; since: number; next: number }>();
  let loop = 0;
  let last = 0;

  const step = (direction: [number, number]) => {
    cursor ??= centreTile();
    // Along the squares' edges, one tile at a time, so every tile is
    // reached: → and ← along x, ↑ and ↓ along y.
    cursor = { x: cursor.x + direction[0], y: cursor.y + direction[1] };
    keepInView(cursor);
    handlers.cursor(cursor);
  };

  /** Moves and pans while keys are held: steps at an even pace, pans smoothly. */
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let panX = 0;
    let panY = 0;
    for (const [key, h] of held) {
      const d = directions[key.length === 1 ? key.toLowerCase() : key];
      if (!d) continue;
      if (h.pan) {
        panX += d[0];
        panY += d[1];
      } else if (now >= h.next) {
        step(d);
        // A pause after the first step, then steady steps.
        h.next = now + (now - h.since < 100 ? 220 : 85);
      }
    }
    if (panX || panY) {
      renderer.pan(-panX * 900 * dt, -panY * 900 * dt);
      handlers.moved();
    }
    loop = held.size ? requestAnimationFrame(tick) : 0;
  };

  const release = (key: string) => {
    held.delete(key);
    held.delete(key.toLowerCase());
    held.delete(key.toUpperCase());
  };

  host.addEventListener("keydown", (event) => {
    // Keys on something inside the map, such as a link in a text, are theirs.
    if (event.target !== host) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (handlers.key(event, true)) {
      event.preventDefault();
      return;
    }
    const direction =
      directions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (direction) {
      event.preventDefault();
      // The keyboard's own repeat is ignored: the loop sets the pace.
      if (event.repeat || held.has(event.key)) return;
      const now = performance.now();
      const pan = event.shiftKey;
      held.set(event.key, { pan, since: now, next: now + 220 });
      if (!pan) step(direction);
      if (!loop) {
        last = now;
        loop = requestAnimationFrame(tick);
      }
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomCentre(1.25);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomCentre(0.8);
    } else if (event.key === "v") {
      event.preventDefault();
      cursor ??= centreTile();
      handlers.cursor(cursor);
      handlers.visual(cursor);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cursor ??= centreTile();
      handlers.cursor(cursor);
      handlers.activate(cursor);
    } else if (event.key === "Escape") {
      handlers.cancel();
    }
  });

  host.addEventListener("keyup", (event) => {
    release(event.key);
    if (event.key === "Shift") for (const h of held.values()) h.pan = false;
    if (event.target === host) handlers.key(event, false);
  });
  host.addEventListener("blur", () => {
    held.clear();
    handlers.release();
  });

  function zoomCentre(factor: number) {
    const box = host.getBoundingClientRect();
    renderer.zoomAt(factor, box.width / 2, box.height / 2);
    handlers.moved();
  }

  /**
   * Keeps the cursor in the middle half of the screen: the view glides after
   * it as soon as it leaves, rather than jumping when it nears the edge.
   */
  function keepInView(tile: Tile) {
    const box = host.getBoundingClientRect();
    // Where the view is going, not where it is mid-glide.
    const aim = renderer.aim;
    const shift = {
      x: aim.x - renderer.camera.x,
      y: aim.y - renderer.camera.y,
    };
    const p = renderer.tileToScreen(
      tile.x + 0.5 - shift.x,
      tile.y + 0.5 - shift.y,
    );
    // The middle half, above the toolbox.
    const left = box.width * 0.25;
    const right = box.width * 0.75;
    const top = box.height * 0.25;
    const bottom = box.height * 0.75 - 45;
    const sx = p.x < left ? p.x - left : p.x > right ? p.x - right : 0;
    const sy = p.y < top ? p.y - top : p.y > bottom ? p.y - bottom : 0;
    if (sx || sy) {
      const from = renderer.screenToTile(box.width / 2, box.height / 2);
      const to = renderer.screenToTile(box.width / 2 + sx, box.height / 2 + sy);
      renderer.glideTo(aim.x + to.x - from.x, aim.y + to.y - from.y);
      handlers.moved();
    }
  }

  return {
    /** The keyboard cursor, if the keyboard has been used. */
    cursor: () => cursor,
    clearCursor() {
      cursor = null;
    },
  };
}
