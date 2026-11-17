/**
 * The HTML on the map. What visitors read and use lies on the ground as real
 * text under the same projection as the ground, so it takes as much space on
 * the map as it needs: scroll texts, the Ortstafel and printed notices on
 * their footprint, and each Spielhaus's plate with its links in front of it.
 * (The theatre's stage is painted on the map: stage.ts.) Pins stand upright
 * over the map:
 * the water names and short status labels. Nodes are cloned from the page's
 * templates or built with the DOM API, never from HTML strings.
 */
import { kinds, TEXT_MARGIN, TEXT_SCALE, type Kind } from "./config";
import { apply, type Linear } from "./iso";
import type { Game } from "./sim";
import type { Building } from "./state";
import { sectionsFor, type GameInfo } from "./texts";
import { labels } from "./waters";

/** A rectangle on the ground, in tiles. */
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Item {
  element: HTMLElement;
  area: Area;
  shown: boolean;
}

interface Pin {
  element: HTMLElement;
  x: number;
  y: number;
  /** Raised above the ground, in world units. */
  lift: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

/** Margins of a text on its footprint, in tiles: a scroll leaves room for its rollers. */
function margins(kind: Kind) {
  return {
    side: TEXT_MARGIN,
    end: kinds[kind].scroll ? TEXT_MARGIN + 0.35 : TEXT_MARGIN,
  };
}

function label(kind: Kind, game: GameInfo | undefined): string {
  return game ? `${kinds[kind].name} ${game.title}` : kinds[kind].name;
}

/** The sheet of a text building, lying on the ground. */
function sheet(kind: Kind, game: GameInfo | undefined): HTMLElement | null {
  const info = kinds[kind];
  const sections = sectionsFor(info, game?.id);
  if (!sections.length) return null;
  const body = el("div", { className: "wg-sheet-body prose" });
  for (const section of sections) body.append(...section.nodes());
  const style = info.scroll
    ? "scroll"
    : kind === "anleitung"
      ? "notice"
      : "board";
  return el(
    "article",
    { className: `wg-flat wg-sheet wg-sheet-${style}` },
    el("h3", { className: "wg-sheet-title" }, label(kind, game)),
    body,
  );
}

const measured = new Map<string, number>();

/**
 * How many tiles long a text building must be for its text: measured once per
 * text in a hidden copy with the map's styles.
 */
export function textLength(
  root: HTMLElement,
  kind: Kind,
  game: GameInfo | undefined,
): number {
  const id = `${kind}:${game?.id ?? ""}`;
  const known = measured.get(id);
  if (known) return known;
  const { side, end } = margins(kind);
  const element = sheet(kind, game);
  if (!element) return 2;
  const box = el("div", { className: "wg-measure" });
  element.style.width = `${(kinds[kind].w - 2 * side) * TEXT_SCALE}px`;
  box.append(element);
  root.append(box);
  const tiles = Math.ceil(element.offsetHeight / TEXT_SCALE + 2 * end);
  box.remove();
  measured.set(id, tiles);
  return tiles;
}

export class WorldLayer {
  /** Texts and plates, lying on the ground. */
  readonly root: HTMLElement;
  /** Upright labels over the map. */
  private pins: HTMLElement;
  private items = new Map<number, Item>();
  private waterPins: (Pin & { basin: boolean })[] = [];
  private toasts = new Map<number, { pin: Pin; until: number }>();
  private lastKey = "";
  private clock = 0;
  private L: Linear | null = null;

  constructor(
    host: HTMLElement,
    private game: Game,
    private games: GameInfo[],
    /** Called when a plate is clicked: turn the view to it. */
    private focus: (b: Building) => void,
  ) {
    this.root = el("div", { className: "wg-world" });
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Im Wald");
    this.pins = el("div", { className: "wg-pins" });
    this.pins.setAttribute("aria-hidden", "true");
    host.append(this.root, this.pins);
    for (const water of labels) {
      const element = el(
        "span",
        { className: water.lake ? "wg-water wg-lake" : "wg-water" },
        water.name,
      );
      this.pins.append(element);
      this.waterPins.push({
        element,
        x: water.x,
        y: water.y,
        lift: 0,
        basin: !!water.basin,
      });
    }
    this.flooded();
    for (const b of game.state.buildings) this.building(b);
  }

  /** The Sihlsee's name appears with the lake. */
  flooded() {
    for (const pin of this.waterPins)
      if (pin.basin) pin.element.hidden = !this.game.state.flooded;
  }

  private gameInfo(id?: string) {
    return this.games.find((g) => g.id === id);
  }

  /** Adds, refreshes or removes what lies on the ground for a building. */
  building(b: Building, removed = false) {
    const existing = this.items.get(b.id);
    const info = kinds[b.kind];
    const wanted =
      !removed && b.state === "done" && (!!info.fit || b.kind === "spielhaus");
    if (existing) {
      if (wanted) return;
      existing.element.remove();
      this.items.delete(b.id);
    }
    if (!wanted) return;
    const made = this.make(b);
    if (!made) return;
    const { element, area } = made;
    element.style.left = `${area.x}px`;
    element.style.top = `${area.y}px`;
    element.style.width = `${area.w * TEXT_SCALE}px`;
    element.style.height = `${area.h * TEXT_SCALE}px`;
    this.root.append(element);
    this.items.set(b.id, { element, area, shown: true });
    this.lastKey = "";
  }

  /** The rectangle a building's text or plate covers, in tiles. */
  area(id: number): Area | undefined {
    return this.items.get(id)?.area;
  }

  private make(b: Building): { element: HTMLElement; area: Area } | null {
    if (b.kind === "spielhaus") return this.plate(b);
    const element = sheet(b.kind, this.gameInfo(b.game));
    if (!element) return null;
    const { side, end } = margins(b.kind);
    return {
      element,
      area: {
        x: b.x + side,
        y: b.y + end,
        w: b.w - 2 * side,
        h: b.h - 2 * end,
      },
    };
  }

  /** The Spielhaus's plate in front of the house, with its links. */
  private plate(b: Building) {
    const game = this.gameInfo(b.game);
    if (!game) return null;
    const plate = el(
      "div",
      { className: "wg-flat wg-plate" },
      el("strong", { className: "wg-plate-title" }, game.title),
      el(
        "span",
        { className: "wg-plate-links" },
        el(
          "a",
          { className: "wg-chip wg-primary", href: game.playUrl },
          "Spielen",
        ),
        el("a", { className: "wg-chip", href: game.sourceUrl }, "Quellcode"),
      ),
    );
    plate.dataset.worldUi = "";
    plate.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("a")) this.focus(b);
    });
    return {
      element: plate,
      area: { x: b.x + 0.1, y: b.y + b.h - 1.35, w: b.w - 0.2, h: 1.25 },
    };
  }

  /** A short status label over a building, for a few seconds. */
  toast(b: Building, text: string) {
    this.toasts.get(b.id)?.pin.element.remove();
    const element = el("span", { className: "wg-toast" }, text);
    this.pins.append(element);
    const pin = { element, x: b.x + b.w / 2, y: b.y + b.h / 2, lift: 70 };
    this.toasts.set(b.id, { pin, until: performance.now() + 2600 });
    this.place(pin);
  }

  private place(pin: Pin) {
    if (!this.L) return;
    const p = apply(this.L, pin.x, pin.y);
    pin.element.style.left = `${p.x}px`;
    pin.element.style.top = `${p.y - pin.lift}px`;
  }

  /** Follows the camera and the view's turning; hides what is off screen. */
  frame(
    t: { x: number; y: number; zoom: number; L: Linear },
    width: number,
    height: number,
  ) {
    this.clock++;
    const now = performance.now();
    for (const [id, toast] of this.toasts) {
      if (now > toast.until) {
        toast.pin.element.remove();
        this.toasts.delete(id);
      }
    }
    const L = t.L;
    const key = `${t.x}:${t.y}:${t.zoom}:${L.a}:${L.b}:${width}:${height}`;
    if (key === this.lastKey && this.clock % 30) return;
    this.lastKey = key;
    const z = t.zoom;
    this.root.style.transform = `matrix(${L.a * z}, ${L.b * z}, ${L.c * z}, ${L.d * z}, ${t.x}, ${t.y})`;
    this.pins.style.transform = `translate(${t.x}px, ${t.y}px) scale(${z})`;
    this.pins.style.setProperty("--wg-zoom", String(z));
    if (L !== this.L) {
      this.L = L;
      for (const pin of this.waterPins) this.place(pin);
      for (const toast of this.toasts.values()) this.place(toast.pin);
    }
    const margin = 200;
    for (const item of this.items.values()) {
      const { x, y, w, h } = item.area;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [cx, cy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        const p = apply(L, cx, cy);
        xs.push(t.x + p.x * z);
        ys.push(t.y + p.y * z);
      }
      const shown =
        Math.max(...xs) > -margin &&
        Math.min(...xs) < width + margin &&
        Math.max(...ys) > -margin &&
        Math.min(...ys) < height + margin;
      if (shown !== item.shown) {
        item.shown = shown;
        item.element.hidden = !shown;
      }
    }
  }
}
