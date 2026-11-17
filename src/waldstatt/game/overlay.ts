/**
 * The HTML layer on the map: what visitors read and use stands in the forest
 * itself, as real text that moves and zooms with the map. Finished scrolls,
 * the Ortstafel and printed controls carry their texts; each Spielhaus has a
 * sign with its links; the theatre's stage plays the previews; and the waters
 * carry their names. Nodes are cloned from the page's templates or built with
 * the DOM API, never from HTML strings.
 */
import { kinds } from "./config";
import { iso } from "./iso";
import type { Game } from "./sim";
import type { Building } from "./state";
import { sectionsFor, sheetWidth, type GameInfo } from "./texts";
import { labels } from "./waters";

interface Item {
  element: HTMLElement;
  /** Anchor in world units: the bottom centre, or the centre if flat. */
  x: number;
  flat: boolean;
  y: number;
  width: number;
  height: number;
  shown: boolean;
}

/** How high above the footprint's centre each kind's text stands. */
const lift: Partial<Record<string, number>> = {
  ortstafel: 54,
  anleitung: 46,
  chronik: 14,
  spielidee: 14,
  spielhaus: 118,
  theater: 36,
};

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

export class WorldLayer {
  readonly root: HTMLElement;
  private items = new Map<number, Item>();
  private waterLabels: { element: HTMLElement; basin: boolean }[] = [];
  private mounted = new Set<string>();
  private lastTransform = "";
  private clock = 0;

  constructor(
    host: HTMLElement,
    private game: Game,
    private games: GameInfo[],
    private stageTemplate: HTMLTemplateElement | null,
    private mountPreview: (section: HTMLElement, game: string) => boolean,
  ) {
    this.root = el("div", { className: "wg-world" });
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Im Wald");
    host.append(this.root);
    for (const label of labels) {
      const p = iso(label.x, label.y);
      const element = el(
        "span",
        { className: label.lake ? "wg-water wg-lake" : "wg-water" },
        label.name,
      );
      element.style.left = `${p.x}px`;
      element.style.top = `${p.y}px`;
      element.setAttribute("aria-hidden", "true");
      this.root.append(element);
      this.waterLabels.push({ element, basin: !!label.basin });
    }
    this.flooded();
    for (const b of game.state.buildings) this.building(b);
  }

  /** The Sihlsee's name appears with the lake. */
  flooded() {
    for (const label of this.waterLabels)
      if (label.basin) label.element.hidden = !this.game.state.flooded;
  }

  private gameInfo(id?: string) {
    return this.games.find((g) => g.id === id);
  }

  /** Adds, refreshes or removes the text or sign that belongs to a building. */
  building(b: Building, removed = false) {
    const existing = this.items.get(b.id);
    const wanted = !removed && b.state === "done" && b.kind in lift;
    if (existing) {
      // The theatre's programme may have grown; then it is built anew.
      const stale =
        !wanted ||
        (b.kind === "theater" &&
          existing.element.dataset.programme !== this.programme());
      if (!stale) return;
      existing.element.remove();
      this.items.delete(b.id);
    }
    if (!wanted) return;
    const element = this.make(b);
    if (!element) return;
    const flat = !!kinds[b.kind].scroll;
    const anchor = iso(b.x + b.w / 2, b.y + b.h / 2, lift[b.kind] ?? 0);
    element.style.left = `${anchor.x}px`;
    element.style.top = `${anchor.y}px`;
    // Texts lying on the ground stay below everything standing; standing
    // signs overlap by depth, nearer ones on top.
    const front = Math.round(iso(b.x + b.w, b.y + b.h).y);
    element.style.zIndex = String(flat ? front - 100000 : front);
    if (flat) element.style.width = `${sheetWidth(b.w, b.h)}px`;
    this.root.append(element);
    this.items.set(b.id, {
      element,
      flat,
      x: anchor.x,
      y: anchor.y,
      width: element.offsetWidth,
      height: element.offsetHeight,
      shown: true,
    });
    this.lastTransform = "";
  }

  /** Called when any Spielhaus changes, so the stage's programme follows. */
  refreshStage() {
    const theatre = this.game.state.buildings.find(
      (b) => b.kind === "theater" && b.state === "done",
    );
    if (theatre) this.building(theatre);
  }

  /**
   * How far above the building's centre its text's middle lies, in world
   * units, measured at full detail, to bring it into view.
   */
  focusOffset(id: number): number {
    const item = this.items.get(id);
    if (!item || item.flat) return 0;
    const lod = this.root.dataset.lod;
    this.root.dataset.lod = "near";
    const height = item.element.offsetHeight;
    if (lod) this.root.dataset.lod = lod;
    return height / 2;
  }

  private label(b: Building): string {
    const game = this.gameInfo(b.game);
    return game ? `${kinds[b.kind].name} ${game.title}` : kinds[b.kind].name;
  }

  private make(b: Building): HTMLElement | null {
    if (b.kind === "spielhaus") return this.sign(b);
    if (b.kind === "theater") return this.stage();
    const info = kinds[b.kind];
    const sections = sectionsFor(info, b.game);
    if (!sections.length) return null;
    const body = el("div", { className: "wg-sheet-body prose" });
    for (const section of sections) body.append(...section.nodes());
    const flat = info.scroll ? " wg-sheet-flat" : "";
    const sheet = el(
      "article",
      { className: `wg-sheet wg-sheet-${b.kind}${flat}` },
      el("h3", { className: "wg-sheet-title" }, this.label(b)),
      body,
    );
    return sheet;
  }

  private sign(b: Building): HTMLElement | null {
    const game = this.gameInfo(b.game);
    if (!game) return null;
    const sign = el(
      "div",
      { className: "wg-sign" },
      el("strong", { className: "wg-sign-title" }, game.title),
      el("p", {}, game.tagline),
      el(
        "p",
        { className: "wg-sign-links" },
        el(
          "a",
          { className: "wg-button wg-primary", href: game.playUrl },
          "Spielen",
        ),
        el("a", { className: "wg-button", href: game.sourceUrl }, "Quellcode"),
      ),
    );
    sign.dataset.worldUi = "";
    return sign;
  }

  private programme(): string {
    return this.games
      .filter((g) => g.preview && this.game.done("spielhaus", g.id))
      .map((g) => g.id)
      .join(",");
  }

  private stage(): HTMLElement {
    const programme = this.programme();
    const ids = programme ? programme.split(",") : [];
    const stage = el(
      "section",
      { className: "wg-stage" },
      el("h3", { className: "wg-sheet-title" }, "Theater der Waldstatt"),
    );
    stage.dataset.worldUi = "";
    stage.dataset.programme = programme;
    if (!ids.length) {
      stage.append(
        el("p", {}, "Das Programm ist leer: Bau zuerst ein Spielhaus."),
      );
      return stage;
    }
    const buttons = el("div", { className: "wg-stage-programme" });
    buttons.setAttribute("role", "group");
    buttons.setAttribute("aria-label", "Programm");
    const play = el("a", { className: "wg-button wg-primary" });
    const shows = new Map<string, HTMLElement>();
    for (const id of ids) {
      const source = this.stageTemplate?.content.querySelector<HTMLElement>(
        `[data-preview="${id}"]`,
      );
      if (!source) continue;
      const show = source.cloneNode(true) as HTMLElement;
      show.hidden = true;
      shows.set(id, show);
      const button = el(
        "button",
        { type: "button", className: "wg-button" },
        this.gameInfo(id)?.title ?? id,
      );
      button.dataset.programme = id;
      button.addEventListener("click", () => choose(id));
      buttons.append(button);
    }
    const choose = (id: string) => {
      for (const button of buttons.querySelectorAll<HTMLElement>("button"))
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.programme === id),
        );
      for (const [show, element] of shows) {
        if (show === id && !this.mounted.has(`${id}`)) {
          if (this.mountPreview(element, id)) this.mounted.add(id);
        }
        element.hidden = show !== id;
      }
      const game = this.gameInfo(id);
      if (game) {
        play.href = game.playUrl;
        play.textContent = `${game.title} richtig spielen`;
      }
    };
    // Mounted previews belong to the old stage; mount again in this one.
    this.mounted.clear();
    stage.append(buttons, ...shows.values(), el("p", {}, play));
    choose(ids[0]);
    return stage;
  }

  /** Follows the camera; hides what is far off screen. */
  frame(
    t: { x: number; y: number; zoom: number },
    width: number,
    height: number,
  ) {
    const key = `${t.x}:${t.y}:${t.zoom}:${width}:${height}`;
    this.clock++;
    if (key === this.lastTransform && this.clock % 30) return;
    this.lastTransform = key;
    this.root.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.zoom})`;
    this.root.style.setProperty("--wg-zoom", String(t.zoom));
    // Far out only names; in between full scroll texts and compact signs;
    // close in everything, the stage included.
    const lod = t.zoom < 0.6 ? "far" : t.zoom < 1.15 ? "mid" : "near";
    if (this.root.dataset.lod !== lod) {
      this.root.dataset.lod = lod;
      for (const item of this.items.values()) {
        item.element.hidden = false;
        item.width = item.element.offsetWidth;
        item.height = item.element.offsetHeight;
        item.shown = true;
      }
    }
    const margin = 200;
    for (const item of this.items.values()) {
      const x0 = t.x + (item.x - item.width / 2) * t.zoom;
      const x1 = t.x + (item.x + item.width / 2) * t.zoom;
      const top = item.flat ? item.y - item.height / 2 : item.y - item.height;
      const y0 = t.y + top * t.zoom;
      const y1 = t.y + (top + item.height) * t.zoom;
      const shown =
        x1 > -margin &&
        x0 < width + margin &&
        y1 > -margin &&
        y0 < height + margin;
      if (shown !== item.shown) {
        item.shown = shown;
        item.element.hidden = !shown;
      }
    }
  }
}
