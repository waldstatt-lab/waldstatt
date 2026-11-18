/**
 * Pointer, touch, wheel and keyboard input on the map. Dragging pans (with
 * the saw, one finger or the left mouse button marks an area instead, and two
 * fingers or another mouse button pan; while placing, a drag that starts on
 * the building being placed moves it); pinching and the wheel zoom; a tap is
 * a short press without movement. Keys are handled only while the map has
 * focus, by the keymap (keys.ts): the movement keys (arrows, h j k l and
 * s e i u by default) move the cursor one tile along the squares' edges,
 * again and again while held, and the view glides after it; digits typed
 * before give a count, so «10» and then → moves ten tiles; with Shift they
 * pan smoothly; + and − zoom; v starts a selection (the saw's or paving's)
 * at the cursor and o jumps to its other corner; Enter or Space applies;
 * Escape drops a count or cancels.
 */
import { actionFor, directions, isModifier, normal } from "./keys";
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
  /**
   * o: the selection's corners swap; returns the corner the cursor jumps
   * to, or null without a selection.
   */
  other(tile: Tile): Tile | null;
  /** The count typed before a movement, or null once it is used or dropped. */
  count(n: number | null): void;
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

  /** The keys held to move the cursor or pan, which way, and since when. */
  const held = new Map<
    string,
    { d: [number, number]; pan: boolean; since: number; next: number }
  >();
  let loop = 0;
  let last = 0;
  /** The count typed before a movement, such as 10 for «10» and then →. */
  let count = 0;
  const maxCount = 9999;

  const setCount = (n: number) => {
    if (n === count) return;
    count = n;
    handlers.count(n || null);
  };

  const step = (direction: [number, number], by = 1) => {
    cursor ??= centreTile();
    // Along the squares' edges, so every tile is reached: → and ← along x,
    // ↑ and ↓ along y.
    cursor = {
      x: cursor.x + direction[0] * by,
      y: cursor.y + direction[1] * by,
    };
    keepInView(cursor);
    handlers.cursor(cursor);
  };

  /** Moves and pans while keys are held: steps at an even pace, pans smoothly. */
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let panX = 0;
    let panY = 0;
    for (const h of held.values()) {
      if (h.pan) {
        panX += h.d[0];
        panY += h.d[1];
      } else if (now >= h.next) {
        step(h.d);
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

  host.addEventListener("keydown", (event) => {
    // Keys on something inside the map, such as a link in a text, are theirs.
    if (event.target !== host) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (handlers.key(event, true)) {
      event.preventDefault();
      return;
    }
    // Digits make a count for the next movement; a lone 0 is nothing.
    // (Shift is allowed: some layouts, such as AZERTY, need it for digits.)
    if (/^[0-9]$/.test(event.key)) {
      if (event.key !== "0" || count)
        setCount(Math.min(maxCount, count * 10 + Number(event.key)));
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      // Escape drops a count first, as in vim.
      if (count) setCount(0);
      else handlers.cancel();
      return;
    }
    const action = actionFor(event.key);
    const direction = action && directions[action];
    if (direction) {
      event.preventDefault();
      const by = count || 1;
      setCount(0);
      // The keyboard's own repeat is ignored: the loop sets the pace.
      const key = normal(event.key);
      if (event.repeat || held.has(key)) return;
      const now = performance.now();
      const pan = event.shiftKey;
      held.set(key, { d: direction, pan, since: now, next: now + 220 });
      if (!pan) step(direction, by);
      if (!loop) {
        last = now;
        loop = requestAnimationFrame(tick);
      }
      return;
    }
    // Any other key drops the count.
    if (!isModifier(event.key)) setCount(0);
    if (action === "zoomIn") {
      event.preventDefault();
      zoomCentre(1.25);
    } else if (action === "zoomOut") {
      event.preventDefault();
      zoomCentre(0.8);
    } else if (action === "visual") {
      event.preventDefault();
      cursor ??= centreTile();
      handlers.cursor(cursor);
      handlers.visual(cursor);
    } else if (action === "other") {
      event.preventDefault();
      cursor ??= centreTile();
      const to = handlers.other(cursor);
      if (to) {
        cursor = to;
        keepInView(cursor);
        handlers.cursor(cursor);
      }
    } else if (action === "apply") {
      event.preventDefault();
      cursor ??= centreTile();
      handlers.cursor(cursor);
      handlers.activate(cursor);
    }
  });

  host.addEventListener("keyup", (event) => {
    held.delete(normal(event.key));
    if (event.key === "Shift") for (const h of held.values()) h.pan = false;
    if (event.target === host) handlers.key(event, false);
  });
  host.addEventListener("blur", () => {
    held.clear();
    setCount(0);
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
    /**
     * Moves the keyboard cursor with a jump of the view, such as to the
     * first clearing or onto a text; nothing while only a pointer is used.
     */
    follow(tile: Tile) {
      if (!cursor) return;
      cursor = { ...tile };
      handlers.cursor(cursor);
    },
  };
}
