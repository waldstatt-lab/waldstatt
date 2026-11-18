/**
 * The HTML interface over the map: the resource bar (in the menu on phones),
 * the toolbox with the tools (axe, saw, paving, tearing down), the build menu
 * with a picture and the name of each building it shows, placing buildings,
 * the crews of producing buildings, and the announcements for screen
 * readers. Nothing explains the game: buildings show their state, and events
 * are announced. Things on the map react directly, without panels or
 * dialogs: a found text or the stage turns the view top-down onto it, a
 * Spielhaus with beer opens its game in a new tab, a ruin is repaired, other
 * buildings show a short status label, and tearing down takes a second tap.
 * Only «Neu beginnen» in the menu asks first. Nodes are created with the DOM
 * API, never from HTML strings.
 */
import { buildingPicture } from "./art";
import {
  balance,
  crewKinds,
  goodKeys,
  goodMax,
  goodName,
  groups,
  kinds,
  recipes,
  STAGE,
  type Cost,
  type Good,
  type Kind,
} from "./config";
import type { MapHandlers, Tile } from "./input";
import { PLAN } from "./iso";
import type { WorldLayer } from "./overlay";
import type { Renderer } from "./render";
import {
  compass,
  isExplored,
  isFound,
  type Game,
  type HiddenText,
} from "./sim";
import { STAGE_RES, type Stage } from "./stage";
import type { Building } from "./state";
import type { GameInfo } from "./texts";
import { damSite, start } from "./world";

type Tool = "none" | "axe" | "saw" | "pave" | "demolish";

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

function need<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export interface UiOptions {
  root: HTMLElement;
  game: Game;
  renderer: Renderer;
  games: GameInfo[];
  world: WorldLayer;
  /** The theatre's stage and its corner in tiles, if a theatre stands. */
  stage(): { stage: Stage; x: number; y: number } | null;
  reset(): void;
  moved(): void;
}

/**
 * The largest zoom for reading: text pixels are about 1.4 screen pixels at
 * zoom 1 in the plan, so the 12 px text reads at about 16 px.
 */
const readingZoom = 0.95;
/** Zoomed out below this share of the reading zoom, the plan turns back to the map. */
const leaveBelow = 0.5;

export class Ui {
  private tool: Tool = "none";
  private placing: {
    kind: Kind;
    game?: string;
    at?: Tile;
    /** Where the building was taken, from the tile it is placed by. */
    hold?: Tile;
    /** Chosen with the mouse: it follows the pointer, and a click builds. */
    mouse?: boolean;
    /** Its card: why it cannot stand here, and «Bauen». */
    note?: HTMLElement;
    build?: HTMLButtonElement;
  } | null = null;
  /** The kind of pointer last pressed: "mouse", "touch" or "pen". */
  private pointerKind = "mouse";
  private sawFrom: Tile | null = null;
  /** The building torn down by the next tap with the Abreissen tool. */
  private doomed: Building | null = null;
  /** While reading or playing: what, and where the camera was. */
  private reading: {
    /** A building's id (the theatre) or a hidden text's key. */
    id: number | string;
    stage: boolean;
    back: { x: number; y: number; zoom: number };
    /** The zoom the view turned to; well below it, the view turns back. */
    zoom: number;
  } | null = null;
  private suppliesDirty = true;

  private toolbox: HTMLElement;
  private buildMenu: HTMLElement;
  private mainMenu: HTMLElement;
  private backBar: HTMLElement;
  /** The card over a tapped building, and the parts of it that change. */
  private card: {
    b: Building;
    state: HTMLElement;
    note: HTMLElement;
    stock: HTMLElement;
    crew?: {
      count: HTMLElement;
      minus: HTMLButtonElement;
      plus: HTMLButtonElement;
    };
    repair?: HTMLButtonElement;
  } | null = null;
  private live: HTMLElement;
  private confirmDialog: HTMLDialogElement;
  private menuItems: {
    kind: Kind;
    game?: string;
    button: HTMLButtonElement;
    item: HTMLElement;
    picture: HTMLCanvasElement;
    drawn: boolean;
  }[] = [];
  private menuGroups: { element: HTMLElement; kinds: Kind[] }[] = [];

  constructor(private o: UiOptions) {
    const root = o.root;
    this.toolbox = need(root, "[data-toolbox]");
    this.buildMenu = need(root, "[data-build-menu]");
    this.mainMenu = need(root, "[data-main-menu]");
    this.backBar = need(root, "[data-back]");
    this.live = need(root, "[data-live]");
    this.confirmDialog = need(root, "[data-confirm]");

    for (const button of this.toolbox.querySelectorAll<HTMLButtonElement>(
      "[data-tool]",
    ))
      button.addEventListener("click", () =>
        this.setTool(button.dataset.tool as Tool),
      );
    need<HTMLButtonElement>(this.toolbox, "[data-open=build]").addEventListener(
      "click",
      (e) =>
        this.toggleMenu(this.buildMenu, e.currentTarget as HTMLButtonElement),
    );
    need<HTMLButtonElement>(this.toolbox, "[data-open=menu]").addEventListener(
      "click",
      (e) =>
        this.toggleMenu(this.mainMenu, e.currentTarget as HTMLButtonElement),
    );
    this.mainMenu.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-act]",
      )?.dataset.act;
      if (!action) return;
      if (action !== "zoom-in" && action !== "zoom-out") this.closeMenus();
      this.menuAction(action);
    });
    need(this.backBar, "button").addEventListener("click", () =>
      this.leaveReading(),
    );

    document.addEventListener("keydown", (event) => {
      // The map handles its own Escape (input.ts); the stage leaves on Escape.
      if (event.key !== "Escape" || event.target === this.mapHost()) return;
      if (this.confirmDialog.open) return;
      if (!this.buildMenu.hidden || !this.mainMenu.hidden) {
        this.closeMenus(true);
        event.preventDefault();
      } else if (this.card) {
        this.closeCard();
      } else if (this.placing) {
        this.stopPlacing();
      } else if (this.reading) {
        this.leaveReading();
      }
    });
    document.addEventListener(
      "pointerdown",
      (event) => (this.pointerKind = event.pointerType),
      { capture: true },
    );
    // A right click stops placing, as Escape does.
    this.mapHost().addEventListener("contextmenu", (event) => {
      if (!this.placing) return;
      event.preventDefault();
      this.stopPlacing();
    });
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (this.toolbox.contains(target)) return;
      if (!this.buildMenu.hidden && !this.buildMenu.contains(target))
        this.closeMenus();
      if (!this.mainMenu.hidden && !this.mainMenu.contains(target))
        this.closeMenus();
    });
    this.renderBuildMenu();
    this.items();
    this.unlocked();
  }

  /** Something appeared in the build menu: the Bauen button shows it. */
  unlocked() {
    need(this.toolbox, "[data-fresh]").hidden = !this.o.game.state.fresh;
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  /** Shows the tools picked up so far, and paving once there are stones. */
  items() {
    for (const tool of ["axe", "saw"] as const) {
      const button = need(this.toolbox, `[data-tool=${tool}]`);
      button.hidden = !this.o.game.state.tools[tool];
    }
    const g = this.o.game;
    need(this.toolbox, "[data-tool=pave]").hidden = !g.state.seen.has("stones");
    this.suppliesDirty = true;
  }

  // --- The card over a building ------------------------------------------------

  /**
   * Opens a card over a building: its name and state, its stock, and for a
   * producing building − and + for its crew; for a ruin, its repair.
   */
  private openCard(b: Building) {
    const g = this.o.game;
    const name = this.label(b.kind, b.game);
    const state = el("p", { className: "wg-card-state" });
    const stock = el("p", { className: "wg-card-stock" });
    const note = el("p", { className: "wg-card-note" });
    const close = el(
      "button",
      { type: "button", className: "wg-card-close" },
      "×",
    );
    close.setAttribute("aria-label", "Schliessen");
    close.addEventListener("click", () => this.closeCard(true));
    const card = el(
      "div",
      {},
      el("p", { className: "wg-card-title" }, name),
      close,
      state,
    );
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", name);
    const entry: NonNullable<Ui["card"]> = { b, state, note, stock };
    if (b.state === "done" && crewKinds.includes(b.kind)) {
      const step = (by: number) => {
        g.setCrew(b, (b.crew ?? 0) + by);
        this.updateCard();
        this.announce(this.crewText(b));
      };
      const minus = el(
        "button",
        { type: "button", className: "wg-button" },
        "−",
      );
      minus.setAttribute("aria-label", "Einen Waldmenschen weniger");
      minus.addEventListener("click", () => step(-1));
      const plus = el(
        "button",
        { type: "button", className: "wg-button" },
        "+",
      );
      plus.setAttribute("aria-label", "Einen Waldmenschen mehr");
      plus.addEventListener("click", () => step(1));
      const count = el("span", { className: "wg-card-count" });
      card.append(el("div", { className: "wg-card-crew" }, minus, count, plus));
      entry.crew = { count, minus, plus };
    }
    if (b.state === "ruin") {
      const repair = el(
        "button",
        { type: "button", className: "wg-button wg-primary" },
        `Reparieren (${this.costText(g.repairCost(b))})`,
      );
      repair.addEventListener("click", () => {
        const missing = g.repair(b);
        this.announce(missing ?? `${name} wird repariert.`);
        this.updateCard();
      });
      card.append(repair);
      entry.repair = repair;
    }
    card.append(stock, note);
    this.card = entry;
    this.o.world.showCard(b, card);
    this.updateCard();
    this.announce(
      [name, state.textContent, stock.textContent, note.textContent]
        .filter(Boolean)
        .join(" "),
    );
  }

  private closeCard(focusMap = false) {
    if (!this.card) return;
    this.card = null;
    this.o.world.closeCard();
    if (focusMap) this.mapHost().focus({ preventScroll: true });
  }

  /** How many Waldleute work in a building, of how many it asks for. */
  private crewText(b: Building): string {
    const there = this.o.game.crewOf(b);
    const want = b.crew ?? 0;
    return `${there} von ${want} Waldleuten`;
  }

  /** Keeps the card's state, crew and stock current, without moving focus. */
  private updateCard() {
    const card = this.card;
    if (!card) return;
    const g = this.o.game;
    const b = card.b;
    if (!g.state.buildings.includes(b)) return this.closeCard();
    const set = (element: HTMLElement, text: string) => {
      if (element.textContent !== text) element.textContent = text;
      element.hidden = !text;
    };
    const recipe = recipes[b.kind];
    let note = "";
    let stock = "";
    if (card.crew && recipe) {
      const there = g.crewOf(b);
      const want = b.crew ?? 0;
      set(card.crew.count, this.crewText(b));
      card.crew.minus.disabled = want <= 0;
      card.crew.plus.disabled = want >= balance.maxCrew;
      const makes = Object.keys(recipe.makes) as Good[];
      const takes = Object.keys(recipe.takes) as Good[];
      stock = makes
        .map(
          (key) =>
            `${goodName(key)}: ${g.state.stock[key]} von ${goodMax(key)}`,
        )
        .join(" · ");
      const lacking = takes.filter(
        (key) => g.state.stock[key] < (recipe.takes[key] ?? 0),
      );
      if (want === 0) note = "Niemand arbeitet hier.";
      else if (there < want)
        note =
          there === 0
            ? "Niemand ist frei: Alle anderen haben schon Arbeit oder sind Kinder."
            : `Es fehlen ${want - there}: Alle anderen haben schon Arbeit oder sind Kinder.`;
      else if (makes.every((key) => g.state.stock[key] >= goodMax(key)))
        note = "Das Lager ist voll. Die Arbeit ruht.";
      else if (lacking.length)
        note = `Es fehlt ${lacking.map((key) => goodName(key)).join(" und ")}.`;
    }
    if (card.repair) {
      card.repair.hidden = b.state !== "ruin";
      if (b.state === "ruin")
        note = g.economy.missing(g.repairCost(b))
          ? `Für die Reparatur fehlen ${g.economy.missing(g.repairCost(b))}.`
          : "";
    }
    const state = this.stateText(b);
    set(card.state, state.charAt(0).toUpperCase() + state.slice(1));
    set(card.stock, stock);
    set(card.note, note);
  }

  private mapHost(): HTMLElement {
    return need(this.o.root, "[data-map]");
  }

  // --- Announcements ------------------------------------------------------

  announce(text: string) {
    this.live.textContent = "";
    window.setTimeout(() => (this.live.textContent = text), 50);
  }

  // --- Supplies and per-frame updates --------------------------------------

  supplies() {
    this.suppliesDirty = true;
  }

  frame() {
    const r = this.o.renderer;
    if (this.reading && !r.flying) {
      // Zooming in and out a little stays in the plan; only from a certain
      // height, half the reading zoom, does the view turn back to the map.
      if (r.camera.zoom < this.reading.zoom * leaveBelow)
        this.leaveReading(true);
    }
    // Motivation and the Waldleute change all the time; a few times a second
    // is enough for them.
    this.clock = (this.clock + 1) % 15;
    if (!this.suppliesDirty && this.clock) return;
    this.suppliesDirty = false;
    const g = this.o.game;
    const s = g.state;
    const values: Record<string, string> = {
      people: `${g.workers.length} / ${g.people.beds()}`,
      mood: `${Math.round(s.mood)} %`,
      deaths: String(s.deaths.age + s.deaths.hunger),
    };
    for (const key of goodKeys) values[key] = String(s.stock[key]);
    const shown = (key: string) =>
      key === "people" ||
      key === "mood" ||
      (key === "deaths" && s.deaths.age + s.deaths.hunger > 0) ||
      s.seen.has(key as Good);
    // How they died, for the tooltip and screen readers.
    const deaths = `Verstorbene: ${s.deaths.age} an Alter, ${s.deaths.hunger} verhungert`;
    for (const element of this.o.root.querySelectorAll<HTMLElement>(
      "[data-resource]",
    )) {
      const key = element.dataset.resource ?? "";
      element.hidden = !shown(key);
      if (key === "deaths" && element.title !== deaths) {
        element.title = deaths;
        const name = element.querySelector<HTMLElement>(
          ".sr-only, .wg-supply-name",
        );
        if (name)
          name.textContent = ` ${deaths.replace("Verstorbene: ", "Verstorbene (")})`;
      }
      const value = element.querySelector<HTMLElement>("[data-value]");
      if (value && value.textContent !== values[key])
        value.textContent = values[key] ?? "";
    }
    if (!this.buildMenu.hidden) this.updateBuildMenu();
    this.updateCard();
  }

  private clock = 0;

  // --- Tools and menus ------------------------------------------------------

  setTool(tool: Tool) {
    if ((tool === "axe" || tool === "saw") && !this.o.game.state.tools[tool])
      return;
    if (this.placing) this.stopPlacing();
    this.tool = this.tool === tool ? "none" : tool;
    this.sawFrom = null;
    this.setDoomed(null);
    this.o.renderer.setSaw(null);
    for (const button of this.toolbox.querySelectorAll<HTMLButtonElement>(
      "[data-tool]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.tool === this.tool),
      );
    this.mapHost().dataset.mode = this.tool;
    const names: Record<Tool, string> = {
      none: "Kein Werkzeug.",
      axe: "Axt.",
      saw: "Säge.",
      pave: "Pflastern.",
      demolish: "Abreissen.",
    };
    this.announce(names[this.tool]);
  }

  private toggleMenu(menu: HTMLElement, button: HTMLButtonElement) {
    const open = menu.hidden;
    this.closeMenus();
    if (!open) return;
    if (menu === this.buildMenu) {
      this.o.game.state.fresh = false;
      this.unlocked();
      this.updateBuildMenu();
    }
    if (menu === this.mainMenu) this.suppliesDirty = true;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLElement>("button, a")?.focus();
  }

  private closeMenus(focusButton = false) {
    for (const [menu, name] of [
      [this.buildMenu, "build"],
      [this.mainMenu, "menu"],
    ] as const) {
      const button = need<HTMLButtonElement>(
        this.toolbox,
        `[data-open=${name}]`,
      );
      if (!menu.hidden && focusButton) button.focus();
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  }

  private menuAction(action: string) {
    const r = this.o.renderer;
    const box = this.mapHost().getBoundingClientRect();
    if (action === "home") {
      if (this.reading) this.leaveReading();
      r.centerOn(start.x + 0.5, start.y + 0.5);
      this.o.moved();
    } else if (action === "zoom-in") {
      r.zoomAt(1.25, box.width / 2, box.height / 2);
      this.o.moved();
    } else if (action === "zoom-out") {
      r.zoomAt(0.8, box.width / 2, box.height / 2);
      this.o.moved();
    } else if (action === "reset") {
      void this.confirm({
        title: "Neu beginnen?",
        text: "Der Wald wächst nach, alle Gebäude und Vorräte gehen verloren. Die Spielstände der Spiele bleiben.",
        yes: "Alles löschen",
      }).then((yes) => {
        if (yes) this.o.reset();
      });
    }
  }

  private gameTitle(id?: string): string {
    return this.o.games.find((g) => g.id === id)?.title ?? "";
  }

  private label(kind: Kind, game?: string): string {
    return game
      ? `${kinds[kind].name} ${this.gameTitle(game)}`
      : kinds[kind].name;
  }

  /** Supplies as text, such as «20 Holz, 12 Steine»; empty parts are left out. */
  private costText(c: Cost): string {
    return goodKeys
      .filter((key) => (c[key] ?? 0) > 0)
      .map((key) => `${c[key]} ${goodName(key)}`)
      .join(", ");
  }

  /**
   * Builds the menu once, as a grid of pictures and names per group;
   * updateBuildMenu() shows what is available and keeps it current in place.
   */
  private renderBuildMenu() {
    const list = need(this.buildMenu, "[data-build-list]");
    list.replaceChildren();
    this.menuItems = [];
    this.menuGroups = [];
    for (const group of groups) {
      const items = el("ul", { className: "wg-build-items" });
      const kindsHere: Kind[] = [];
      for (const [kind, info] of Object.entries(kinds) as [
        Kind,
        (typeof kinds)[Kind],
      ][]) {
        if (info.group !== group) continue;
        kindsHere.push(kind);
        const games =
          info.limit === "game" ? this.o.games.map((g) => g.id) : [undefined];
        for (const game of games) {
          const picture = el("canvas", { width: 144, height: 112 });
          picture.setAttribute("aria-hidden", "true");
          const button = el(
            "button",
            { type: "button", className: "wg-build-item" },
            picture,
            el("span", { className: "wg-build-name" }, this.label(kind, game)),
          );
          button.dataset.build = `${kind}:${game ?? ""}`;
          button.addEventListener("click", (event) => {
            const why = this.o.game.unavailable(kind, game);
            if (why) return this.announce(`${this.label(kind, game)}: ${why}`);
            this.closeMenus();
            // Chosen with the mouse (not the keyboard, whose click has no
            // detail): the building follows the mouse.
            const mouse = event.detail > 0 && this.pointerKind === "mouse";
            this.startPlacing(kind, game, mouse);
          });
          const item = el("li", {}, button);
          items.append(item);
          this.menuItems.push({
            kind,
            game,
            button,
            item,
            picture,
            drawn: false,
          });
        }
      }
      const element = el(
        "section",
        {},
        el("h3", { className: "wg-build-group" }, group),
        items,
      );
      list.append(element);
      this.menuGroups.push({ element, kinds: kindsHere });
    }
    this.updateBuildMenu();
  }

  /** Paints a building's picture small for its place in the menu. */
  private drawPicture(entry: (typeof this.menuItems)[number]) {
    if (entry.drawn) return;
    entry.drawn = true;
    const info = kinds[entry.kind];
    const w = entry.kind === "bruecke" ? 3 : info.w;
    const { canvas, flat } = buildingPicture(
      entry.kind,
      w,
      info.h,
      entry.game,
      "x",
      this.gameTitle(entry.game),
    );
    const ctx = entry.picture.getContext("2d");
    if (!ctx) return;
    const { width, height } = entry.picture;
    const k = Math.min(width / canvas.width, height / canvas.height);
    // A field's or pasture's ground first, then its house.
    for (const part of [flat, canvas])
      if (part)
        ctx.drawImage(
          part,
          (width - canvas.width * k) / 2,
          (height - canvas.height * k) / 2,
          canvas.width * k,
          canvas.height * k,
        );
  }

  /** Shows what is available and marks what cannot be built now. */
  private updateBuildMenu() {
    const g = this.o.game;
    const shown = new Set<Kind>();
    for (const entry of this.menuItems) {
      const visible = g.shown(entry.kind, entry.game);
      entry.item.hidden = !visible;
      if (!visible) continue;
      shown.add(entry.kind);
      this.drawPicture(entry);
      if (g.unavailable(entry.kind, entry.game))
        entry.button.setAttribute("aria-disabled", "true");
      else entry.button.removeAttribute("aria-disabled");
    }
    for (const group of this.menuGroups)
      group.element.hidden = !group.kinds.some((k) => shown.has(k));
  }

  // --- Placing ----------------------------------------------------------------

  /**
   * Starts placing a building. A card on it names it and its costs and says
   * why it cannot stand where it is. With the mouse it follows the pointer
   * and a click builds; by touch it is dragged or tapped into place, and the
   * card's «Bauen» builds; × or Escape stops.
   */
  private startPlacing(kind: Kind, game?: string, mouse = false) {
    if (this.reading) this.leaveReading();
    this.setDoomed(null);
    this.closeCard();
    this.placing = { kind, game, mouse: mouse && kind !== "damm" };
    this.mapHost().dataset.mode = "place";
    const text = this.placingText();
    const note = el("p", { className: "wg-card-note" });
    const build = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Bauen",
    );
    build.addEventListener("click", () => {
      if (this.placing?.at) this.tryPlace(this.placing.at);
    });
    const close = el(
      "button",
      { type: "button", className: "wg-card-close" },
      "×",
    );
    close.setAttribute("aria-label", "Abbrechen");
    close.addEventListener("click", () => {
      this.stopPlacing();
      this.mapHost().focus({ preventScroll: true });
    });
    const card = el(
      "div",
      {
        className: this.placing.mouse
          ? "wg-place-card wg-place-mouse"
          : "wg-place-card",
      },
      el("p", { className: "wg-card-title" }, text),
      build,
      close,
      note,
    );
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", text);
    this.placing.note = note;
    this.placing.build = build;
    this.o.world.showCardAt({ x: 0, y: 0 }, card);
    const r = this.o.renderer;
    if (kind === "damm") {
      // The dam has its one site.
      r.camera.zoom = r.clampZoom(Math.min(r.camera.zoom, 1.6));
      r.centerOn(damSite.x + damSite.w / 2, damSite.y + damSite.h / 2);
      this.o.moved();
      this.ghostAt({ x: damSite.x, y: damSite.y });
    } else {
      const box = this.mapHost().getBoundingClientRect();
      const centre = r.screenToTile(box.width / 2, box.height / 2);
      this.ghostAt({ x: Math.floor(centre.x), y: Math.floor(centre.y) });
    }
    this.announce(text);
    this.mapHost().focus();
  }

  /** The building's name and costs, such as «Hütte: 8 Holz.» */
  private placingText(): string {
    if (!this.placing) return "";
    const { kind, game } = this.placing;
    const name = this.label(kind, game);
    const cost = this.costText(kinds[kind].cost);
    return cost ? `${name}: ${cost}.` : `${name}.`;
  }

  private anchor(tile: Tile): Tile {
    if (!this.placing) return tile;
    const { w, h } = this.o.game.size(this.placing.kind);
    return { x: tile.x - Math.floor(w / 2), y: tile.y - Math.floor(h / 2) };
  }

  private ghostAt(tile: Tile) {
    if (!this.placing) return;
    this.placing.at = tile;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, at.x, at.y);
    this.o.renderer.setGhost(spot, { kind, game });
    const { note, build, mouse } = this.placing;
    if (build) build.disabled = !spot.ok;
    if (note) {
      const text = spot.ok
        ? mouse
          ? "Klick: bauen · Esc: abbrechen"
          : ""
        : (spot.reason ?? "Hier nicht.");
      if (note.textContent !== text) note.textContent = text;
      note.hidden = !text;
    }
    this.o.world.moveCard({ x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 });
  }

  private tryPlace(tile: Tile) {
    if (!this.placing) return;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, at.x, at.y);
    if (!spot.ok) return this.announce(spot.reason ?? "Hier nicht.");
    const b = this.o.game.place(kind, game, at.x, at.y);
    if (!b)
      return this.announce(
        this.o.game.unavailable(kind, game) ?? "Hier nicht.",
      );
    this.announce(
      `${this.label(kind, game)} ist eine Baustelle. Die Waldleute kommen.`,
    );
    this.stopPlacing();
  }

  private stopPlacing() {
    if (!this.placing) return;
    this.placing = null;
    this.o.world.closeCard();
    this.o.renderer.setGhost(null);
    this.mapHost().dataset.mode = this.tool;
  }

  // --- Map handlers -------------------------------------------------------------

  /** The stage, while the view is turned onto the theatre. */
  private playing() {
    if (!this.reading?.stage) return null;
    return this.o.stage();
  }

  handlers(): MapHandlers {
    return {
      press: (at) => {
        const on = this.playing();
        if (!on || this.placing) return false;
        const result = on.stage.pressAt(
          (at.x - on.x) * STAGE_RES,
          (at.y - on.y) * STAGE_RES,
        );
        if (result.open) this.openGame(result.open);
        return result.handled;
      },
      release: () => this.o.stage()?.stage.release(),
      key: (event, down) => {
        const on = this.playing();
        if (!on || this.placing || event.key === "Escape") return false;
        return on.stage.key(event, down);
      },
      sawing: () =>
        (this.tool === "saw" || this.tool === "pave") &&
        !this.placing &&
        !this.reading,
      grab: (tile) => {
        const p = this.placing;
        // With the mouse it follows the pointer anyway.
        if (!p?.at || p.kind === "damm" || p.mouse) return false;
        const at = this.anchor(p.at);
        const spot = this.o.game.placement(p.kind, at.x, at.y);
        const inside =
          tile.x >= spot.x &&
          tile.x < spot.x + spot.w &&
          tile.y >= spot.y &&
          tile.y < spot.y + spot.h;
        if (!inside) return false;
        p.hold = { x: tile.x - p.at.x, y: tile.y - p.at.y };
        return true;
      },
      drag: (tile) => {
        const hold = this.placing?.hold ?? { x: 0, y: 0 };
        this.ghostAt({ x: tile.x - hold.x, y: tile.y - hold.y });
      },
      tap: (tile) => {
        if (this.placing) {
          // With the mouse a click builds. By touch, a tap on the building
          // leaves it and anywhere else moves it there; «Hier bauen» builds.
          if (this.placing.mouse) return this.tryPlace(tile);
          const hold = this.placing.hold;
          this.placing.hold = undefined;
          if (!hold) this.ghostAt(tile);
          return;
        }
        // A tap beside an open card only closes it.
        if (this.card) return this.closeCard();
        this.activateTile(tile);
      },
      // With a mouse, the building being placed follows the pointer.
      hover: (tile) => {
        if (this.placing && !this.placing.hold) this.ghostAt(tile);
      },
      saw: (from, to, done) => {
        this.o.renderer.setSaw(
          done ? null : { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
        );
        if (done) this.sawArea(from, to);
      },
      cursor: (tile) => {
        this.o.renderer.setCursor(tile);
        if (this.placing) this.ghostAt(tile);
        if (this.sawFrom)
          this.o.renderer.setSaw({
            x0: this.sawFrom.x,
            y0: this.sawFrom.y,
            x1: tile.x,
            y1: tile.y,
          });
      },
      activate: (tile) => {
        if (this.placing) return this.tryPlace(tile);
        if ((this.tool === "saw" || this.tool === "pave") && !this.reading) {
          if (!this.sawFrom) {
            this.sawFrom = tile;
            this.o.renderer.setSaw({
              x0: tile.x,
              y0: tile.y,
              x1: tile.x,
              y1: tile.y,
            });
            this.announce(
              "Erste Ecke gesetzt. Pfeiltasten, dann Eingabetaste für die zweite.",
            );
          } else {
            const from = this.sawFrom;
            this.sawFrom = null;
            this.o.renderer.setSaw(null);
            this.sawArea(from, tile);
          }
          return;
        }
        if (this.card) return this.closeCard();
        this.activateTile(tile);
      },
      cancel: () => {
        if (this.sawFrom) {
          this.sawFrom = null;
          this.o.renderer.setSaw(null);
        } else if (this.placing) this.stopPlacing();
        else if (this.reading) this.leaveReading();
        else if (this.card) this.closeCard();
        else if (this.doomed) this.setDoomed(null);
        else if (this.tool !== "none") this.setTool(this.tool);
      },
      moved: () => this.o.moved(),
    };
  }

  /** A dragged area: the saw marks its trees, paving plans its free tiles. */
  private sawArea(from: Tile, to: Tile) {
    if (this.tool === "pave") {
      const count = this.o.game.paveArea(from.x, from.y, to.x, to.y);
      return this.announce(
        count === 1
          ? "Ein Feld wird gepflastert."
          : `${count} Felder werden gepflastert.`,
      );
    }
    const count = this.o.game.markArea(from.x, from.y, to.x, to.y);
    this.announce(
      count === 1 ? "Ein Baum markiert." : `${count} Bäume markiert.`,
    );
  }

  private activateTile(tile: Tile) {
    const g = this.o.game;
    const item = g.pickUp(tile.x, tile.y);
    if (item) {
      this.setTool(item);
      return this.announce(
        item === "axe" ? "Du hast die Axt." : "Du hast die Säge.",
      );
    }
    const b = g.buildingAt(tile.x, tile.y);
    if (this.reading && b?.id === this.reading.id) return;
    const text = g.textAt(tile.x, tile.y);
    if (text && this.reading?.id === text.key) return;
    if (this.tool === "demolish") {
      if (b) this.demolish(b);
      else {
        this.setDoomed(null);
        this.announce("Tippe auf ein Gebäude, das weg soll.");
      }
      return;
    }
    if (b) return this.react(b);
    if (this.tool === "pave") {
      const result = g.togglePaving(tile.x, tile.y);
      if (result === "planned") this.announce("Wird gepflastert.");
      else if (result === "unplanned") this.announce("Pflaster gestrichen.");
      else this.announce("Gepflastert wird nur freier, trockener Boden.");
      return;
    }
    // A found text: unless the axe marks one of its trees, read it.
    if (
      text &&
      isFound(text) &&
      !(this.tool === "axe" && g.isTree(tile.x, tile.y))
    )
      return this.readText(text);
    if (this.tool === "axe") {
      const result = g.toggleMark(tile.x, tile.y);
      if (result === "marked") this.announce("Baum markiert.");
      else if (result === "unmarked") this.announce("Markierung entfernt.");
    }
  }

  // --- Buildings react directly ---------------------------------------------------

  /**
   * A tap on a building: play on the stage, open the game or its source,
   * set a crew, repair a ruin, or show how it is doing.
   */
  private react(b: Building) {
    const g = this.o.game;
    const say = (text: string) => {
      this.o.world.toast(b, text);
      this.announce(text);
    };
    if (b.state === "done" && b.kind === "theater") {
      if (!g.economy.open(b)) return this.openCard(b);
      return this.readStage(b);
    }
    const game = this.o.games.find((x) => x.id === b.game);
    if (b.state === "done" && game && b.kind === "spielhaus") {
      if (!g.economy.open(b)) return this.openCard(b);
      g.mood.event("play");
      this.openGame(game.playUrl);
      return say(`${game.title} öffnet sich in einem neuen Tab.`);
    }
    if (b.state === "done" && game && b.kind === "bibliothek") {
      this.openGame(game.sourceUrl);
      return say(
        `Der Quellcode von ${game.title} öffnet sich in einem neuen Tab.`,
      );
    }
    this.openCard(b);
  }

  /** Called when something on a building changes. */
  building(b: Building, removed: boolean) {
    if (removed && this.doomed?.id === b.id) this.setDoomed(null);
    if (removed && this.reading?.id === b.id) this.leaveReading();
    if (removed && this.card?.b.id === b.id) this.closeCard();
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  private stateText(b: Building): string {
    const g = this.o.game;
    const s = g.state;
    if (b.state === "drowned") return "überflutet.";
    if (b.state === "site") {
      const percent = Math.round(g.progress(b) * 100);
      return percent === 0 ? "Baustelle." : `im Bau, ${percent} %.`;
    }
    const condition =
      (b.condition ?? 1) < balance.working ? " Es verfällt." : "";
    switch (b.kind) {
      case "huette":
      case "steinhaus":
        return `${kinds[b.kind].beds} Betten. In der Waldstatt leben ${g.workers.length}, Betten gibt es ${g.people.beds()}.`;
      case "klause":
        return `hier lebte einst der Einsiedler Meinrad.${condition}`;
      case "kirche":
        return `die Glocken läuten.${condition}`;
      case "kloster":
        return `der Stolz der Waldstatt.${condition}`;
      case "friedhof":
        return `${b.graves ?? 0} von ${balance.graves} Gräbern.`;
      case "brot": {
        const thrown = b.thrown ?? 0;
        return thrown
          ? `${thrown} von ${balance.brotLoaves} Broten ausgeworfen.`
          : `wartet auf ${balance.brotLoaves} Brote. Vorrat: ${s.stock.bread}.`;
      }
      case "ise":
        return "in der Schmiede glüht das Feuer.";
      case "spielhaus":
        return g.economy.open(b) ? "offen." : "geschlossen, kein Bier.";
      case "damm":
        return `der Sihlsee ist zu ${Math.round(s.flood.level * 100)} % voll.`;
      case "bruecke":
        return "hier kommen die Waldleute über den Fluss.";
      case "hafen":
        return this.portText(b);
      case "schiff":
        return "fährt die Waldleute zu den anderen Häfen am See.";
      default:
        // Producing buildings show their crew and stock instead.
        return "";
    }
  }

  private portText(b: Building): string {
    const { ports, ships } = this.o.game.harbour(b);
    if (!ships) return "noch liegt kein Schiff hier.";
    if (ports < 2) return "kein zweiter Hafen am See.";
    return ships === 1
      ? "ein Schiff fährt über diesen See."
      : `${ships} Schiffe fahren über diesen See.`;
  }

  /** The Abreissen tool: the first tap marks a building, the second tears it down. */
  private demolish(b: Building) {
    if (!this.o.game.canDemolish(b)) {
      this.setDoomed(null);
      return this.announce("Das liegt unter Wasser.");
    }
    const name = this.label(b.kind, b.game);
    if (this.doomed?.id !== b.id) {
      const refund = this.costText(this.o.game.refund(b));
      this.setDoomed(b);
      const text = refund
        ? `Nochmals tippen: ${name} abreissen (${refund} zurück).`
        : `Nochmals tippen: ${name} abreissen.`;
      this.o.world.toast(b, text);
      return this.announce(text);
    }
    this.setDoomed(null);
    this.o.game.demolish(b);
    this.announce(`${name} abgerissen.`);
  }

  private setDoomed(b: Building | null) {
    this.doomed = b;
    this.o.renderer.setSelected(b, 0xd8432f);
  }

  // --- Reading and playing on the map --------------------------------------------

  /** Opens a game or its source code in a new tab, so the Waldstatt stays as it is. */
  private openGame(url: string) {
    window.open(url, "_blank", "noopener");
  }

  /** Turns the view top-down onto the theatre's stage, to play on it. */
  private readStage(b: Building) {
    this.read(
      b.id,
      {
        x: b.x + STAGE.u0,
        y: b.y + STAGE.v0,
        w: STAGE.u1 - STAGE.u0,
        h: STAGE.v1 - STAGE.v0,
      },
      true,
      "Die Bühne. Tipp die Schilder an oder spiel mit den Tasten aus der Steuerung.",
    );
  }

  /** Turns the view top-down onto a found text, to read it. */
  private readText(t: HiddenText) {
    const area = this.o.world.area(t.key) ?? t;
    const rest = isExplored(t) ? "" : " Ein Teil liegt noch unter Bäumen.";
    this.read(t.key, area, false, `${this.o.world.title(t)}.${rest}`);
  }

  /** Turns the view top-down onto an area: a text or the stage. */
  private read(
    id: number | string,
    area: { x: number; y: number; w: number; h: number },
    stage: boolean,
    what: string,
  ) {
    const r = this.o.renderer;
    const box = this.mapHost().getBoundingClientRect();
    // Clear of the back button above and the toolbox below.
    const usable = { w: box.width * 0.92, h: (box.height - 200) * 0.95 };
    const fit = usable.w / (area.w * PLAN);
    let zoom = Math.min(readingZoom, fit);
    // Centred between the back button and the toolbox.
    const shift = (box.height / 2 - (70 + usable.h / 2)) / PLAN;
    let y = area.y + area.h / 2;
    if (stage) {
      // The stage fits as a whole.
      zoom = Math.min(2, fit, usable.h / (area.h * PLAN));
    } else if (area.h * PLAN * zoom > usable.h) {
      // A long text starts at its top; the rest is a pan away.
      y = area.y + (usable.h / 2 - 24) / (PLAN * zoom);
    }
    y += shift / zoom;
    this.reading = {
      id,
      stage,
      back: this.reading?.back ?? { ...r.camera },
      zoom,
    };
    r.flyTo({ x: area.x + area.w / 2, y, zoom, plan: 1 });
    this.backBar.hidden = false;
    this.o.moved();
    this.announce(`${what} Escape oder «Zurück zur Karte» kehrt zurück.`);
  }

  /**
   * Turns the view back to the map: to where it was, or, after zooming out
   * of the text, from where and how high the view is now.
   */
  private leaveReading(zoomedOut = false) {
    if (!this.reading) return;
    const back = this.reading.back;
    this.reading = null;
    this.o.stage()?.stage.release();
    this.backBar.hidden = true;
    const r = this.o.renderer;
    this.o.renderer.flyTo(
      zoomedOut
        ? { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom, plan: 0 }
        : { ...back, plan: 0 },
    );
    this.o.moved();
    this.mapHost().focus({ preventScroll: true });
  }

  /** Something more of a hidden text lies free, or it was just found. */
  text(t: HiddenText, found: boolean) {
    const title = this.o.world.title(t);
    if (found) this.announce(`Unter den Bäumen liegt etwas: ${title}.`);
    else if (isExplored(t)) this.announce(`${title} liegt ganz frei.`);
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  /** A raven took up a new scroll to lead to. */
  raven(t: HiddenText | undefined) {
    if (!t) return;
    const where = compass(
      { x: start.x + 0.5, y: start.y + 0.5 },
      { x: t.x + t.w / 2, y: t.y + t.h / 2 },
    );
    this.announce(`Ein Rabe fliegt los, nach ${where}.`);
  }

  // --- Confirmations ------------------------------------------------------------------

  private confirm(o: {
    title: string;
    text: string;
    yes: string;
  }): Promise<boolean> {
    const d = this.confirmDialog;
    need(d, "[data-confirm-title]").textContent = o.title;
    need(d, "[data-confirm-text]").textContent = o.text;
    need(d, "[data-confirm-yes]").textContent = o.yes;
    d.returnValue = "";
    d.showModal();
    return new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue === "yes"), {
        once: true,
      });
    });
  }
}
