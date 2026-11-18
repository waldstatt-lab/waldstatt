/**
 * The HTML on the map. What visitors read lies on the ground as real text
 * under the same projection as the ground, so it takes as much space on the
 * map as it needs. The hidden texts, once found, lie under the map's canvas:
 * the ground leaves a gap on each cleared tile of a found text (render.ts),
 * so the text lies on the floor, and the trees still standing, the Waldleute
 * and the buildings stand over it. Each Spielhaus's plate with its links lies
 * over the canvas, in front of its house. (The theatre's stage is painted on the map:
 * stage.ts.) Pins stand upright over the map: the water names, Einsiedeln,
 * and short status labels. Nodes are cloned from the page's templates or
 * built with the DOM API, never from HTML strings.
 */
import { TEXT_MARGIN, TEXT_SCALE, texts, type TextKind } from "./config";
import { groundTexture } from "./art";
import { apply, type Linear } from "./iso";
import { isFound, type Game, type HiddenText } from "./sim";
import type { Building } from "./state";
import { sectionsFor, type GameInfo } from "./texts";
import { basinLabel, type WaterLabel } from "./waters";
import { loadedPages, onPage, town, type LoadedPage } from "./world";

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

/** Margins of a text on its footprint, in tiles: a scroll leaves room for its rolled ends. */
function margins(kind: TextKind) {
  return {
    side: TEXT_MARGIN,
    end: texts[kind].style === "scroll" ? TEXT_MARGIN + 0.35 : TEXT_MARGIN,
  };
}

/** A text's title: its name, or the game's title for a game's scroll. */
export function textTitle(kind: TextKind, game: GameInfo | undefined): string {
  return kind === "game" && game
    ? `${texts.game.name} ${game.title}`
    : texts[kind].name;
}

/** The sheet of a hidden text, lying on the ground. */
function sheet(kind: TextKind, game: GameInfo | undefined): HTMLElement | null {
  const sections = sectionsFor(kind, game?.id);
  if (!sections.length) return null;
  const body = el("div", { className: "wg-sheet-body prose" });
  for (const section of sections) body.append(...section.nodes());
  const heading = el(
    "h3",
    { className: "wg-sheet-title" },
    kind === "game" && game ? game.title : texts[kind].name,
  );
  const tagline =
    kind === "game" && game?.tagline
      ? [el("p", { className: "wg-sheet-tagline" }, game.tagline)]
      : [];
  return el(
    "article",
    { className: `wg-sheet wg-sheet-${texts[kind].style}` },
    heading,
    ...tagline,
    body,
  );
}

const measured = new Map<string, number>();

/**
 * How many tiles long a text must be: measured once per text in a hidden
 * copy with the map's styles.
 */
export function textLength(
  root: HTMLElement,
  kind: TextKind,
  game: GameInfo | undefined,
): number {
  const id = `${kind}:${game?.id ?? ""}`;
  const known = measured.get(id);
  if (known) return known;
  const { side, end } = margins(kind);
  const element = sheet(kind, game);
  if (!element) return 2;
  const box = el("div", { className: "wg-measure" });
  element.style.width = `${(texts[kind].w - 2 * side) * TEXT_SCALE}px`;
  box.append(element);
  root.append(box);
  const tiles = Math.ceil(element.offsetHeight / TEXT_SCALE + 2 * end);
  box.remove();
  measured.set(id, tiles);
  return tiles;
}

export class WorldLayer {
  /** Plates, lying over the map. */
  readonly root: HTMLElement;
  /** Found texts, lying under the map's ground. */
  readonly floor: HTMLElement;
  /** Upright labels over the map. */
  private pins: HTMLElement;
  /** By building id (plates) or text key (texts). */
  private items = new Map<number | string, Item>();
  private waterPins: (Pin & { basin: boolean })[] = [];
  private placePins: Pin[] = [];
  private toasts = new Map<number, { pin: Pin; until: number }>();
  private lastKey = "";
  private clock = 0;
  private L: Linear | null = null;

  constructor(
    host: HTMLElement,
    private game: Game,
    private games: GameInfo[],
  ) {
    this.root = el("div", { className: "wg-world" });
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Im Wald");
    this.floor = el("div", { className: "wg-world wg-floor" });
    this.floor.setAttribute("role", "region");
    this.floor.setAttribute("aria-label", "Schriften im Wald");
    const meadow = groundTexture("meadow").toDataURL();
    this.floor.style.setProperty("--wg-meadow", `url(${meadow})`);
    this.pins = el("div", { className: "wg-pins" });
    this.pins.setAttribute("aria-hidden", "true");
    host.prepend(this.floor);
    host.append(this.root, this.pins);
    if (basinLabel) this.waterPin(basinLabel, true);
    for (const page of loadedPages()) this.page(page);
    onPage((page) => this.page(page));
    // Where the town's texts lie hidden: the village round the Klosterplatz.
    const village = el("span", { className: "wg-place" }, "Einsiedeln");
    this.pins.append(village);
    this.placePins.push({
      element: village,
      x: town.x + 0.5,
      y: town.y + 0.5,
      lift: 0,
    });
    this.flooded();
    for (const b of game.state.buildings) this.building(b);
    for (const t of game.hidden) this.text(t);
  }

  /** A page of water arrived: the names of its rivers and lakes. */
  private page(page: LoadedPage) {
    for (const label of page.data?.labels ?? []) this.waterPin(label, false);
  }

  private waterPin(water: WaterLabel, basin: boolean) {
    const element = el(
      "span",
      { className: water.lake ? "wg-water wg-lake" : "wg-water" },
      water.name,
    );
    this.pins.append(element);
    const pin = { element, x: water.x, y: water.y, lift: 0, basin };
    this.waterPins.push(pin);
    this.place(pin);
    if (basin) element.hidden = !this.game.state.flooded;
  }

  /** The Sihlsee's name appears with the lake. */
  flooded() {
    for (const pin of this.waterPins)
      if (pin.basin) pin.element.hidden = !this.game.state.flooded;
  }

  private gameInfo(id?: string) {
    return this.games.find((g) => g.id === id);
  }

  title(t: HiddenText): string {
    return textTitle(t.kind, this.gameInfo(t.game));
  }

  private add(
    id: number | string,
    element: HTMLElement,
    area: Area,
    layer: HTMLElement,
  ) {
    element.style.left = `${area.x}px`;
    element.style.top = `${area.y}px`;
    element.style.width = `${area.w * TEXT_SCALE}px`;
    element.style.height = `${area.h * TEXT_SCALE}px`;
    layer.append(element);
    this.items.set(id, { element, area, shown: true });
    this.lastKey = "";
  }

  /** Adds, refreshes or removes a Spielhaus's plate. */
  building(b: Building, removed = false) {
    const existing = this.items.get(b.id);
    const wanted = !removed && b.state === "done" && b.kind === "spielhaus";
    if (existing) {
      if (wanted) return;
      existing.element.remove();
      this.items.delete(b.id);
    }
    if (!wanted) return;
    const made = this.plate(b);
    if (made) this.add(b.id, made.element, made.area, this.root);
  }

  /**
   * Lays a found text under the ground; the ground's gaps over its cleared
   * tiles show it.
   */
  text(t: HiddenText) {
    if (!isFound(t) || this.items.has(t.key)) return;
    const content = sheet(t.kind, this.gameInfo(t.game));
    if (!content) return;
    const { side, end } = margins(t.kind);
    const element = el("div", { className: "wg-flat wg-find" });
    content.style.position = "absolute";
    content.style.left = `${side * TEXT_SCALE}px`;
    content.style.top = `${end * TEXT_SCALE}px`;
    content.style.width = `${(t.w - 2 * side) * TEXT_SCALE}px`;
    content.style.height = `${(t.h - 2 * end) * TEXT_SCALE}px`;
    element.append(content);
    this.add(t.key, element, { x: t.x, y: t.y, w: t.w, h: t.h }, this.floor);
  }

  /** The rectangle a text covers, in tiles, without its margins. */
  area(key: string): Area | undefined {
    const t = this.game.text(key);
    if (!t) return undefined;
    const { side, end } = margins(t.kind);
    return { x: t.x + side, y: t.y + end, w: t.w - 2 * side, h: t.h - 2 * end };
  }

  /** The Spielhaus's plate in front of the house, with its links. */
  private plate(b: Building) {
    const game = this.gameInfo(b.game);
    if (!game) return null;
    const link = (text: string, href: string, primary: boolean) => {
      const a = el(
        "a",
        { className: primary ? "wg-chip wg-primary" : "wg-chip", href },
        text,
      );
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    };
    const plate = el(
      "div",
      { className: "wg-flat wg-plate" },
      el("strong", { className: "wg-plate-title" }, game.title),
      el(
        "span",
        { className: "wg-plate-links" },
        link("Spielen", game.playUrl, true),
        link("Quellcode", game.sourceUrl, false),
      ),
    );
    plate.dataset.worldUi = "";
    return {
      element: plate,
      area: { x: b.x + 0.6, y: b.y + b.h - 1.3, w: b.w - 1.2, h: 1.2 },
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
    const matrix = `matrix(${L.a * z}, ${L.b * z}, ${L.c * z}, ${L.d * z}, ${t.x}, ${t.y})`;
    this.root.style.transform = matrix;
    this.floor.style.transform = matrix;
    this.pins.style.transform = `translate(${t.x}px, ${t.y}px) scale(${z})`;
    this.pins.style.setProperty("--wg-zoom", String(z));
    if (L !== this.L) {
      this.L = L;
      for (const pin of this.waterPins) this.place(pin);
      for (const pin of this.placePins) this.place(pin);
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
