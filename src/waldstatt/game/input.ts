/**
 * Pointer, touch, wheel and keyboard input on the map. Dragging pans (with
 * the saw, one finger or the left mouse button marks an area instead, and two
 * fingers or another mouse button pan); pinching and the wheel zoom; a tap is
 * a short press without movement. Keys are handled only while the map has
 * focus: arrows move the cursor tile, Shift and arrows pan, + and − zoom,
 * Enter or Space applies, Escape cancels.
 */
import type { Renderer } from "./render";

export interface Tile {
  x: number;
  y: number;
}

export interface MapHandlers {
  /** Whether a one-finger or left-button drag marks an area (the saw). */
  sawing(): boolean;
  tap(tile: Tile, pointer: string): void;
  hover(tile: Tile): void;
  saw(from: Tile, to: Tile, done: boolean): void;
  cursor(tile: Tile): void;
  activate(tile: Tile): void;
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
    // Signs and the stage on the map handle their own clicks.
    if ((event.target as Element).closest?.("[data-world-ui]")) return;
    host.focus({ preventScroll: true });
    const point = local(event);
    pointers.set(event.pointerId, point);
    host.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      downAt = { ...point, time: performance.now(), id: event.pointerId };
      moved = false;
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
    if (downAt && Math.hypot(point.x - downAt.x, point.y - downAt.y) > tapSlop)
      moved = true;
    if (pointers.size >= 2) {
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
    const point = local(event);
    pointers.delete(event.pointerId);
    if (pointers.size > 0) {
      pinch = spread();
      return;
    }
    if (sawFrom) {
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

  host.addEventListener("keydown", (event) => {
    // Keys on the stage or a sign's links are theirs.
    if (event.target !== host) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      if (event.shiftKey) {
        renderer.pan(-step[0] * 160, -step[1] * 160);
        handlers.moved();
        return;
      }
      cursor ??= centreTile();
      cursor = { x: cursor.x + step[0], y: cursor.y + step[1] };
      keepInView(cursor);
      handlers.cursor(cursor);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomCentre(1.25);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomCentre(0.8);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cursor ??= centreTile();
      handlers.cursor(cursor);
      handlers.activate(cursor);
    } else if (event.key === "Escape") {
      handlers.cancel();
    }
  });

  function zoomCentre(factor: number) {
    const box = host.getBoundingClientRect();
    renderer.zoomAt(factor, box.width / 2, box.height / 2);
    handlers.moved();
  }

  /** Pans so the cursor stays at least three tiles inside the screen. */
  function keepInView(tile: Tile) {
    const box = host.getBoundingClientRect();
    const margin = 3;
    const a = renderer.screenToTile(0, 0);
    const b = renderer.screenToTile(box.width, box.height - 90);
    let dx = 0;
    let dy = 0;
    if (tile.x < a.x + margin) dx = tile.x - (a.x + margin);
    if (tile.x + 1 > b.x - margin) dx = tile.x + 1 - (b.x - margin);
    if (tile.y < a.y + margin) dy = tile.y - (a.y + margin);
    if (tile.y + 1 > b.y - margin) dy = tile.y + 1 - (b.y - margin);
    if (dx || dy) {
      renderer.centerOn(renderer.camera.x + dx, renderer.camera.y + dy);
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
