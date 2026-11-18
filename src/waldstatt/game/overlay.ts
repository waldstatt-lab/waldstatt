/**
 * The HTML on the map. What visitors read lies on the ground as real text
 * under the same projection as the ground, so it takes as much space on the
 * map as it needs. The hidden texts, once found, lie under the map's canvas:
 * the ground leaves a gap on each cleared tile of a found text (render.ts),
 * so the text lies on the floor, and the trees still standing, the Waldleute
 * and the buildings stand over it. The text is light on a dark green floor;
 * on cobbled tiles, a dark copy of it shows instead, so it stays readable.
 * (The game's titles on its houses and the theatre's stage are painted on the
 * map: art.ts, stage.ts.) Pins stand upright over the map: the water names, Einsiedeln,
 * and short status labels. Nodes are cloned from the page's templates or
 * built with the DOM API, never from HTML strings.
 */
import {
  TEXT_MARGIN,
  TEXT_SCALE,
  texts,
  textWidth,
  type TextKind,
} from "./config";
import { textFloor } from "./art";
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

/** The text of a hidden text, lying on the ground. */
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

/** A canvas as an object URL whose image is already decoded. */
async function decodedUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve),
  );
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL();
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    // Shown as soon as it loads, then.
  }
  return url;
}

/** Sets or clears a layer's mask, with the prefixed property for Safari. */
function mask(element: HTMLElement, url: string | null) {
  element.style.maskImage = url ?? "";
  element.style.setProperty("-webkit-mask-image", url ?? "");
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
  element.style.width = `${(textWidth(kind) - 2 * side) * TEXT_SCALE}px`;
  box.append(element);
  root.append(box);
  const tiles = Math.ceil(element.offsetHeight / TEXT_SCALE + 2 * end);
  box.remove();
  measured.set(id, tiles);
  return tiles;
}

export class WorldLayer {
  /** Found texts, lying under the map's ground. */
  readonly floor: HTMLElement;
  /** Upright labels over the map. */
  private pins: HTMLElement;
  /** The found texts' places, by text key. */
  private items = new Map<string, Item>();
  /** The found texts: their two inks and the cobbles they were painted for. */
  private finds = new Map<
    string,
    {
      element: HTMLElement;
      light: HTMLElement;
      dark: HTMLElement;
      paved: string | null;
      /** The object URLs of its floor and masks. */
      urls: string[];
    }
  >();
  private pending = new Set<HiddenText>();
  private paveTimer = 0;
  private repaving = false;
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
    this.floor = el("div", { className: "wg-world wg-floor" });
    this.floor.setAttribute("role", "region");
    this.floor.setAttribute("aria-label", "Schriften im Wald");
    this.pins = el("div", { className: "wg-pins" });
    this.pins.setAttribute("aria-hidden", "true");
    host.prepend(this.floor);
    host.append(this.pins);
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

  private add(id: string, element: HTMLElement, area: Area) {
    element.style.left = `${area.x}px`;
    element.style.top = `${area.y}px`;
    element.style.width = `${area.w * TEXT_SCALE}px`;
    element.style.height = `${area.h * TEXT_SCALE}px`;
    this.floor.append(element);
    this.items.set(id, { element, area, shown: true });
    this.lastKey = "";
  }

  /**
   * Lays a found text under the ground; the ground's gaps over its cleared
   * tiles show it. Called again when its tiles are cobbled.
   */
  text(t: HiddenText) {
    if (!isFound(t)) return;
    if (!this.finds.has(t.key)) {
      const game = this.gameInfo(t.game);
      const light = sheet(t.kind, game);
      const dark = sheet(t.kind, game);
      if (!light || !dark) return;
      const { side, end } = margins(t.kind);
      const element = el("div", { className: "wg-flat wg-find" });
      const layer = (content: HTMLElement, ink: "light" | "dark") => {
        content.style.position = "absolute";
        content.style.left = `${side * TEXT_SCALE}px`;
        content.style.top = `${end * TEXT_SCALE}px`;
        content.style.width = `${(t.w - 2 * side) * TEXT_SCALE}px`;
        content.style.height = `${(t.h - 2 * end) * TEXT_SCALE}px`;
        const wrap = el("div", { className: `wg-ink wg-ink-${ink}` }, content);
        element.append(wrap);
        return wrap;
      };
      const lightLayer = layer(light, "light");
      const darkLayer = layer(dark, "dark");
      // The dark copy is only for the eye; the light one is read out.
      darkLayer.setAttribute("aria-hidden", "true");
      darkLayer.hidden = true;
      this.finds.set(t.key, {
        element,
        light: lightLayer,
        dark: darkLayer,
        paved: null,
        urls: [],
      });
      this.add(t.key, element, { x: t.x, y: t.y, w: t.w, h: t.h });
    }
    this.pending.add(t);
    if (!this.paveTimer)
      this.paveTimer = window.setTimeout(() => void this.repave(), 200);
  }

  /**
   * Paints the floor under the texts whose cobbles changed and shows each
   * ink where it reads: light on the green, dark on the stones. The new
   * pictures are decoded before they replace the old ones, all at once, so
   * the text never shows without its floor or masks.
   */
  private async repave() {
    this.paveTimer = 0;
    if (this.repaving) {
      this.paveTimer = window.setTimeout(() => void this.repave(), 200);
      return;
    }
    this.repaving = true;
    const due = [...this.pending];
    this.pending.clear();
    try {
      for (const t of due) await this.repaveText(t);
    } finally {
      this.repaving = false;
    }
  }

  private async repaveText(t: HiddenText) {
    const find = this.finds.get(t.key);
    if (!find) return;
    const paved = (u: number, v: number) => this.game.isPaved(t.x + u, t.y + v);
    let signature = "";
    for (let v = 0; v < t.h; v++)
      for (let u = 0; u < t.w; u++) signature += paved(u, v) ? "1" : "0";
    if (signature === find.paved) return;
    const any = signature.includes("1");
    const pictures = [textFloor(t.w, t.h, TEXT_SCALE, paved)];
    if (any)
      // Four mask pixels per tile, so the inks change within a quarter tile.
      for (const ink of ["light", "dark"] as const) {
        const canvas = document.createElement("canvas");
        canvas.width = t.w * 4;
        canvas.height = t.h * 4;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#fff";
          for (let v = 0; v < t.h; v++)
            for (let u = 0; u < t.w; u++)
              if (paved(u, v) === (ink === "dark"))
                ctx.fillRect(u * 4, v * 4, 4, 4);
        }
        pictures.push(canvas);
      }
    const urls = await Promise.all(pictures.map(decodedUrl));
    find.paved = signature;
    find.element.style.backgroundImage = `url(${urls[0]})`;
    find.dark.hidden = !any;
    mask(find.light, any ? `url(${urls[1]})` : null);
    mask(find.dark, any ? `url(${urls[2]})` : null);
    // The old pictures go once the new ones show.
    const old = find.urls;
    find.urls = urls;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        old.forEach((url) => URL.revokeObjectURL(url)),
      ),
    );
  }

  /** The rectangle a text covers, in tiles, without its margins. */
  area(key: string): Area | undefined {
    const t = this.game.text(key);
    if (!t) return undefined;
    const { side, end } = margins(t.kind);
    return { x: t.x + side, y: t.y + end, w: t.w - 2 * side, h: t.h - 2 * end };
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
