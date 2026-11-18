/**
 * The HTML interface over the map: the resource bar (in the menu on phones),
 * the toolbox with the tools (Holzhacken, which takes the axe and, once found,
 * the saw; paving; repairing; tearing down), the build menu
 * with a picture and the name of each building it shows, placing buildings,
 * the crews of producing buildings, and the announcements for screen
 * readers. Nothing explains the game: buildings show their state, and events
 * are announced. Things on the map react directly, without panels or
 * dialogs: a found text or the stage turns the view top-down onto it, a
 * Spielhaus with beer opens its game in a new tab, other buildings open a
 * small card with their state, condition, crew and repair, the Reparieren
 * tool orders a repair with one tap, and tearing down takes a second tap.
 * Only «Neu beginnen» and the saved forests in the menu (savesDialog.ts) ask
 * first. Keys run commands (commands.ts, commandSet.ts) through the key
 * dispatcher (dispatch.ts) and the keymap (keymap.ts); the «:» finder lists
 * the same commands, and the help texts list their keys.
 * Nodes are created with the DOM API, never from HTML strings.
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
import { slug, type Choice, type Commands, type Context } from "./commands";
import { Dispatcher } from "./dispatch";
import type { attachInput, MapHandlers, Tile } from "./input";
import {
  keyLabel,
  keysFor,
  keySpoken,
  macroName,
  onChange as onKeysChange,
  setMacro,
} from "./keymap";
import { PLAN } from "./iso";
import type { WorldLayer } from "./overlay";
import { TextCursor, type TextAction } from "./textCursor";
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
import { most, points, share, wearLevel, wearNames } from "./wear";
import { damSite, start } from "./world";

/** «fell» is Holzhacken: the axe, upgraded to the saw once it is found. */
type Tool = "none" | "fell" | "pave" | "repair" | "demolish";
type PlaceMode = "mouse" | "keys" | "touch";

/** An entry of the finder: what it shows, a hint, and what it does. */
interface FinderItem {
  label: string;
  hint?: string;
  /** Why it cannot run now; it shows greyed. */
  why?: string;
  run(): void;
}

/** Lower case, without accents: «Säge» matches «sage». */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/**
 * How well a query matches a label, as in a fuzzy finder: its letters in
 * order, anywhere; more for letters in a row and at word starts, less for
 * gaps. −1 if it does not match.
 */
function fuzzy(query: string, label: string): number {
  const q = plain(query.trim());
  const t = plain(label);
  if (!q) return 0;
  let score = 0;
  let at = 0;
  let run = 0;
  for (const c of q) {
    const i = t.indexOf(c, at);
    if (i < 0) return -1;
    run = i === at ? run + 1 : 0;
    const start = i === 0 || /[:\s-]/.test(t[i - 1]);
    score += 1 + run * 2 + (start ? 3 : 0) - Math.min(3, i - at) * 0.3;
    at = i + 1;
  }
  return score - t.length * 0.01;
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

/** An action's first letter key, as vim names it, or else its first key. */
/** The first key bound to a command, as shown, or «:command» if none is. */
const firstKey = (command: string) => {
  const keys = keysFor(command)[0];
  return keys ? keyLabel(keys) : `:${command}`;
};

/** The first key of a command made of characters (as «gg»), else its first. */
const letterKey = (command: string) =>
  keysFor(command)
    .find((k) => k.every((x) => [...x].length === 1))
    ?.join("") ?? firstKey(command);

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
  /** Opens the saved forests. */
  saves(): void;
  /** Opens the keymap. */
  keys(): void;
  /** The commands, which keys and the «:» finder run. */
  commands: Commands;
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
    /**
     * How it was chosen: with the mouse it follows the pointer and a click
     * builds; with the keyboard it follows the cursor and Enter builds; by
     * touch it is dragged or tapped into place and the card's «Bauen» builds.
     */
    mode: PlaceMode;
    /** Its card: why it cannot stand here, and «Bauen». */
    note?: HTMLElement;
    build?: HTMLButtonElement;
  } | null = null;
  /** The kind of pointer last pressed: "mouse", "touch" or "pen". */
  private pointerKind = "mouse";
  /** The keyboard cursor's tile, once the keyboard moved it. */
  private keyCursor: Tile | null = null;
  private sawFrom: Tile | null = null;
  /**
   * Whether the area being selected with Holzhacken unmarks: it began on a
   * marked tree. Set when it begins, so jumping to its other corner keeps it.
   */
  private unmarking = false;
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
    /**
     * The keyboard cursor before the view turned: while it stays there, the
     * view turns back to where it was; moved, the view turns back onto it.
     */
    cursor: Tile | null;
  } | null = null;
  /**
   * The text mode on a text read top-down with the keyboard (textCursor.ts),
   * and whether its cursor shows yet.
   */
  textMode: { cursor: TextCursor; shown: boolean } | null = null;
  /** The map's keyboard cursor, once input is attached. */
  private input: ReturnType<typeof attachInput> | null = null;
  /** Every key goes through it, once input is attached. */
  private dispatcher: Dispatcher;
  private suppliesDirty = true;

  private toolbox: HTMLElement;
  private buildMenu: HTMLElement;
  private mainMenu: HTMLElement;
  private backBar: HTMLElement;
  /** The card over a tapped building, and the parts of it that change. */
  card: {
    b: Building;
    state: HTMLElement;
    condition: HTMLElement;
    note: HTMLElement;
    stock: HTMLElement;
    crew?: {
      count: HTMLElement;
      minus: HTMLButtonElement;
      plus: HTMLButtonElement;
    };
    repair: HTMLButtonElement;
    clear: HTMLButtonElement;
  } | null = null;
  private live: HTMLElement;
  private confirmDialog: HTMLDialogElement;
  /** The building chosen when the finder opened, for its commands. */
  private chosen: Building | undefined;
  /** The finder: «/» for the texts found, «:» for commands. */
  private finder: {
    element: HTMLElement;
    input: HTMLInputElement;
    list: HTMLElement;
    prefix: HTMLElement;
    mode: "/" | ":";
    shown: FinderItem[];
    selected: number;
  };
  private menuItems: {
    kind: Kind;
    game?: string;
    button: HTMLButtonElement;
    item: HTMLElement;
    picture: HTMLCanvasElement;
    drawn: boolean;
  }[] = [];
  private menuGroups: { element: HTMLElement; kinds: Kind[] }[] = [];
  /** Where focus goes back to when an open menu closes with Escape. */
  private menuBack: HTMLElement | null = null;

  constructor(readonly o: UiOptions) {
    const root = o.root;
    this.toolbox = need(root, "[data-toolbox]");
    this.buildMenu = need(root, "[data-build-menu]");
    this.mainMenu = need(root, "[data-main-menu]");
    this.backBar = need(root, "[data-back]");
    this.live = need(root, "[data-live]");
    this.confirmDialog = need(root, "[data-confirm]");
    this.finder = {
      element: need(root, "[data-finder]"),
      input: need<HTMLInputElement>(root, "[data-finder-input]"),
      list: need(root, "[data-finder-list]"),
      prefix: need(root, "[data-finder-prefix]"),
      mode: ":",
      shown: [],
      selected: 0,
    };
    this.dispatcher = new Dispatcher(o.commands, {
      contexts: () => this.contexts(),
      status: (count, keys) => this.showStatus(count, keys),
      pan: (dx, dy, dt) => this.input?.pan(dx, dy, dt),
      announce: (text) => this.announce(text),
    });
    o.commands.onChange(() => this.showStatus());
    this.attachFinder();
    this.attachShortcuts();
    // Ctrl+C copies the text mode's selection, as y does.
    document.addEventListener("copy", (event) => {
      const text = this.textMode?.cursor.selectedText();
      if (!text || document.activeElement !== this.mapHost()) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      this.announce("Kopiert.");
    });
    this.describeKeys();
    onKeysChange(() => {
      this.describeKeys();
      // The placing card names the key that builds.
      if (this.placing?.at) this.ghostAt(this.placing.at);
    });

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
      // Back to where the menu was opened from, so a dialog returns there too.
      if (action !== "zoom-in" && action !== "zoom-out") this.closeMenus(true);
      this.menuAction(action);
    });
    need(this.backBar, "button").addEventListener("click", () =>
      this.leaveReading(),
    );

    document.addEventListener("keydown", (event) => {
      // The map handles its own Escape (input.ts); the stage leaves on Escape.
      if (event.key !== "Escape" || event.target === this.mapHost()) return;
      if (this.o.root.querySelector("dialog[open]")) return;
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

  /**
   * Shows Holzhacken once the axe is picked up, with the saw once that is,
   * and paving once there are stones.
   */
  items() {
    const g = this.o.game;
    const fell = need(this.toolbox, "[data-tool=fell]");
    fell.hidden = !g.state.tools.axe;
    fell.toggleAttribute("data-saw", g.state.tools.saw);
    need(this.toolbox, "[data-tool=pave]").hidden = !g.state.seen.has("stones");
    this.repairTool();
    this.suppliesDirty = true;
  }

  /** Shows Reparieren once a building stands that wears. */
  private repairTool() {
    const button = need(this.toolbox, "[data-tool=repair]");
    if (!button.hidden) return;
    button.hidden = !this.o.game.state.buildings.some(
      (b) => (b.state === "done" || b.state === "ruin") && most(b) > 0,
    );
  }

  // --- The card over a building ------------------------------------------------

  /**
   * Opens a card over a building: its name, state and condition, its stock,
   * for a producing building − and + for its crew, its repair, and for a
   * ruin its clearing away.
   */
  private openCard(b: Building) {
    const g = this.o.game;
    const name = this.label(b.kind, b.game);
    const state = el("p", { className: "wg-card-state" });
    const condition = el("p", { className: "wg-card-condition" });
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
      condition,
    );
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", name);
    // The card keeps its keys from the map, so its own keys are taken here.
    card.addEventListener("keydown", (event) => {
      if (this.dispatcher.keydown(event, "card")) event.preventDefault();
    });
    card.addEventListener("keyup", (event) => this.dispatcher.keyup(event));
    const repair = el("button", {
      type: "button",
      className: "wg-button wg-primary",
    });
    repair.addEventListener("click", () => {
      this.repair(b);
      this.updateCard();
    });
    const clear = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Wegräumen",
    );
    clear.addEventListener("click", () => {
      if (g.demolish(b) === "clearing")
        this.announce(`Die Waldleute räumen die Ruine ${name} weg.`);
      this.updateCard();
    });
    const entry: NonNullable<Ui["card"]> = {
      b,
      state,
      condition,
      note,
      stock,
      repair,
      clear,
    };
    if (b.state === "done" && crewKinds.includes(b.kind)) {
      const step = (by: number) => this.stepCrew(by);
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
    card.append(repair, clear, stock, note);
    this.card = entry;
    this.o.world.showCard(b, card);
    this.updateCard();
    this.announce(
      [
        name,
        state.textContent,
        condition.textContent,
        stock.textContent,
        note.textContent,
      ]
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

  /** Repairs the building of the open card (`card:repair`). */
  repairCard() {
    const card = this.card;
    if (!card) return;
    this.repair(card.b);
    this.updateCard();
  }

  /** Puts one Waldmensch more or fewer into the building of the open card. */
  stepCrew(by: number) {
    const b = this.card?.b;
    if (!b || !this.card?.crew) return;
    this.o.game.setCrew(b, (b.crew ?? 0) + by);
    this.updateCard();
    this.announce(this.crewText(b));
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
    // Its condition, its repair, and for a ruin its clearing away.
    const ruin = b.state === "ruin";
    const repairable = !g.unrepairable(b);
    const cost = this.costText(g.repairCost(b));
    set(
      card.repair,
      repairable ? (cost ? `Reparieren (${cost})` : "Reparieren") : "",
    );
    card.clear.hidden = !ruin || !!b.clearing;
    card.clear.disabled = !g.canDemolish(b);
    let condition = "";
    if (b.state === "done" && most(b) > 0)
      condition = `Zustand: ${points(b)} von ${most(b)}, ${wearNames[wearLevel(b)]}.`;
    if (b.repair) note = `Wird repariert: ${Math.round(share(b) * 100)} %.`;
    else if (b.clearing)
      note = `Wird weggeräumt: ${Math.round(g.progress(b) * 100)} %.`;
    else if (repairable && g.economy.missing(g.repairCost(b)))
      note = `Für die Reparatur fehlen ${g.economy.missing(g.repairCost(b))}.`;
    else if (ruin)
      note =
        g.undemolishable(b) ??
        "Wegräumen gibt nichts zurück und ist viel Arbeit.";
    set(card.condition, condition);
    const state = this.stateText(b);
    set(card.state, state.charAt(0).toUpperCase() + state.slice(1));
    set(card.stock, stock);
    set(card.note, note);
  }

  /** The map's input, so that jumps of the view take the cursor along. */
  useInput(input: ReturnType<typeof attachInput>) {
    this.input = input;
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
    // The text cursor shows once the view has turned onto the text.
    if (this.textMode && !this.textMode.shown && !r.flying)
      this.textMode.shown = this.textMode.cursor.show();
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
    if (tool === "fell" && !this.o.game.state.tools.axe) return;
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
      fell: this.o.game.state.tools.saw
        ? "Holzhacken mit der Säge."
        : "Holzhacken mit der Axt.",
      pave: "Pflastern.",
      repair: "Reparieren.",
      demolish: "Abreissen.",
    };
    this.announce(names[this.tool]);
  }

  /**
   * Opens or closes a menu. Escape closes it and returns focus to `back`:
   * the button when it was clicked, the map when a key or the finder
   * opened it from there.
   */
  private toggleMenu(
    menu: HTMLElement,
    button: HTMLButtonElement,
    back: HTMLElement = button,
  ) {
    const open = menu.hidden;
    // Closed by its key from inside, focus goes back as with Escape.
    this.closeMenus(!open && menu.contains(document.activeElement));
    if (!open) return;
    this.menuBack = back;
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
      if (!menu.hidden && focusButton) {
        const back = this.menuBack;
        // Not into the menu itself, nor onto something gone or hidden.
        if (back?.isConnected && back.getClientRects().length)
          back.focus({ preventScroll: true });
        else button.focus();
      }
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  }

  // --- Keyboard shortcuts and the finder ----------------------------------------

  /**
   * Writes the keys into the map's description for screen readers and into
   * the menu's list, from the keymap, again after each change.
   */
  private describeKeys() {
    const said = (command: string) =>
      keysFor(command).map(keySpoken).join(" oder ") || "keine Taste";
    need(this.o.root, "[data-map-help]").textContent = [
      `${said("left")}, ${said("right")}, ${said("up")} und ${said("down")} bewegen die Auswahl nach links, rechts, oben und unten; Ziffern davor bewegen so viele Felder weit, mit Umschalt verschieben sie die Karte.`,
      `${said("zoom:in")} und ${said("zoom:out")} zoomen.`,
      `${said("enter")} wendet das Werkzeug an oder tippt an, was unter der Auswahl liegt; ${said("selection:start")} beginnt ein Rechteck für Holzhacken mit der Säge oder Pflaster, ${said("selection:other")} springt zu seiner anderen Ecke.`,
      `${said("tool:holzhacken")}, ${said("tool:pflastern")}, ${said("tool:reparieren")} und ${said("tool:abreissen")} wählen Holzhacken, Pflastern, Reparieren und Abreissen, ${said("menu:build")} öffnet Bauen, ${said("menu:main")} das Menü, ${said("find:texts")} springt zum Start oder zu gefundenen Schriften, ${said("find:commands")} öffnet Befehle.`,
      `${said("macro:record")} nimmt ein Makro auf und beendet die Aufnahme, ${said("macro:replay")} spielt das letzte ab; Ziffern davor so oft.`,
      `Liest du eine Schrift von oben, macht ${said("enter")} auf ihr die Auswahl zum Textcursor, bis Escape: ${said("text:left")}, ${said("text:right")}, ${said("text:up")} und ${said("text:down")} bewegen ihn um Zeichen und Zeilen, ${said("text:word-next")}, ${said("text:word-back")} und ${said("text:word-end")} um Wörter, ${said("text:start")} zum Anfang, ${said("text:end")} zur letzten Zeile, Ziffern davor so oft; ${said("text:select")} wählt Zeichen aus, ${said("text:select-line")} Zeilen, ${said("text:other")} springt zum anderen Ende, ${said("text:copy")} kopiert.`,
      `Auf der Karte eines Gebäudes repariert ${said("card:repair")} es; auf der Karte einer Werkstatt geben ${said("crew:more")} einen Waldmenschen mehr hinein und ${said("crew:less")} einen weniger.`,
      "Escape bricht ab. Im Menü unter «Tasten» lassen sich die Tasten und Makros ändern.",
    ].join(" ");
    const keys = (command: string) => keysFor(command).map(keyLabel).join(" ");
    const list = (pairs: [string, string][]) =>
      pairs
        .filter(([c]) => keysFor(c).length)
        .map(([c, n]) => `${keys(c)} ${n}`);
    const moves = ["left", "right", "up", "down"].map(keys).filter(Boolean);
    need(this.o.root, "[data-keys-help]").textContent = [
      ...(moves.length
        ? [`${moves.join(", ")} bewegen, Ziffern davor so weit`]
        : []),
      ...list([
        ["selection:start", "Auswahl"],
        ["selection:other", "andere Ecke"],
        ["tool:holzhacken", "Holzhacken"],
        ["tool:pflastern", "Pflastern"],
        ["tool:reparieren", "Reparieren"],
        ["tool:abreissen", "Abreissen"],
        ["menu:build", "Bauen"],
        ["menu:main", "Menü"],
        ["find:texts", "Start und Schriften"],
        ["find:commands", "Befehle"],
        ["macro:record", "Makro aufnehmen"],
        ["macro:replay", "Makro abspielen"],
      ]),
      `im Text: ${[
        "text:left",
        "text:down",
        "text:up",
        "text:right",
        "text:word-next",
        "text:word-back",
        "text:word-end",
        "text:start",
        "text:end",
        "text:select",
        "text:select-line",
        "text:other",
        "text:copy",
      ]
        // Letters first, as «h» before «←», and «g g» as «gg».
        .map((c) => {
          const all = keysFor(c);
          const letters = all.find((k) => k.every((x) => [...x].length === 1));
          return (letters ?? all[0])?.join("") ?? "";
        })
        .filter(Boolean)
        .join(" ")}`,
      `auf der Karte eines Gebäudes: ${list([
        ["card:repair", "reparieren"],
        ["crew:more", "mehr"],
        ["crew:less", "weniger Waldleute"],
      ]).join(", ")}`,
    ]
      .join(" · ")
      .replace(/^/, "Tasten: ");
  }

  /**
   * Keys anywhere on the page, as long as nothing else takes them (a text
   * field, a dialog, the finder, or the stage while somebody plays): the
   * commands that work anywhere, such as the tools, menus and finders.
   */
  private attachShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, dialog[open], a")) return;
      if (!this.finder.element.hidden || this.reading?.stage) return;
      // Escape on a menu opened by key returns where the key was pressed.
      this.menuBack =
        target instanceof HTMLElement && target !== document.body
          ? target
          : this.mapHost();
      if (this.dispatcher.keydown(event, "page")) event.preventDefault();
    });
    document.addEventListener("keyup", (event) => {
      if (event.target !== this.mapHost()) this.dispatcher.keyup(event);
    });
  }

  /** The contexts the keys are in now (ADR 0006). */
  private contexts(): Set<Context> {
    const active = new Set<Context>(["map"]);
    if (this.placing) active.add("placing");
    if (this.reading) active.add("reading");
    if (this.textMode) active.add("text");
    if (this.card) active.add("card");
    return active;
  }

  /** Shows the count and keys typed so far, and a recording under way. */
  private showStatus(count = 0, keys: string[] = []) {
    const shown = need(this.o.root, "[data-count]");
    const text = [
      count ? String(count) : "",
      keys.length ? `${keyLabel(keys)} …` : "",
    ]
      .filter(Boolean)
      .join(" ");
    shown.textContent = text;
    shown.hidden = !text;
    need(this.o.root, "[data-recording]").hidden = !this.o.commands.isRecording;
  }

  private attachFinder() {
    const f = this.finder;
    f.input.addEventListener("input", () => this.filterFinder());
    f.input.addEventListener("keydown", (event) => {
      const move = (by: number) => {
        event.preventDefault();
        if (!f.shown.length) return;
        f.selected = (f.selected + by + f.shown.length) % f.shown.length;
        this.markFinder();
      };
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey))
        move(1);
      else if (
        event.key === "ArrowUp" ||
        (event.key === "Tab" && event.shiftKey)
      )
        move(-1);
      else if (event.key === "Enter") {
        event.preventDefault();
        this.runFinder(f.shown[f.selected]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeFinder(true);
      } else if (event.key === "Backspace" && !f.input.value) {
        // Like a command line: deleting the prefix leaves it.
        event.preventDefault();
        this.closeFinder(true);
      }
    });
    f.input.addEventListener("blur", () => {
      // Clicking an item happens before the blur closes the finder.
      window.setTimeout(() => {
        if (!f.element.contains(document.activeElement)) this.closeFinder();
      }, 150);
    });
  }

  /** Opens the finder: «/» for the texts found, «:» for commands. */
  openFinder(mode: "/" | ":") {
    this.closeMenus();
    // The building chosen: the one whose card is open, or under the cursor.
    const cursor = this.keyCursor;
    this.chosen =
      this.card?.b ??
      (cursor ? this.o.game.buildingAt(cursor.x, cursor.y) : undefined);
    this.closeCard();
    const f = this.finder;
    f.mode = mode;
    f.prefix.textContent = mode;
    f.input.value = "";
    f.input.setAttribute(
      "aria-label",
      mode === "/" ? "Schrift suchen" : "Befehl suchen",
    );
    f.element.hidden = false;
    this.filterFinder();
    f.input.focus();
  }

  private closeFinder(focusMap = false) {
    const f = this.finder;
    if (f.element.hidden) return;
    f.element.hidden = true;
    this.chosen = undefined;
    if (focusMap) this.mapHost().focus({ preventScroll: true });
  }

  /**
   * What the finder lists for what is typed. «/»: the start and the texts
   * found (the `goto` commands). «:»: every command, matched fuzzily by its
   * id and its German description; what is typed runs as it is if it reads
   * as a command or a chain, such as `up:20` or `build:hütte;enter;right:3`,
   * and «rep 30» reads as `repair:under:30`.
   */
  private finderItems(query: string): FinderItem[] {
    const c = this.o.commands;
    const keys = (text: string) => {
      const k = keysFor(text)[0];
      return k ? ` · ${keyLabel(k)}` : "";
    };
    const item = (
      text: string,
      description: string,
      why?: string,
    ): FinderItem => ({
      label: text,
      hint: `${description}${keys(text)}`,
      why,
      run: () => {
        if (!c.runText(text) && why) this.announce(why);
      },
    });
    const all = c.entries();
    if (this.finder.mode === "/") {
      return all
        .filter((e) => e.text === "goto:start" || e.text.startsWith("goto:"))
        .map((e) => ({
          ...item(e.text, e.description, e.why),
          label: e.text.replace(/^goto:/, ""),
        }))
        .map((i) => ({ i, score: query.trim() ? fuzzy(query, i.label) : 0 }))
        .filter((m) => m.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((m) => m.i);
    }
    const typed: FinderItem[] = [];
    const q = query.trim();
    if (q) {
      // As typed, or with spaces for colons, such as «rep 30».
      for (const text of [q, q.replace(/\s+/g, ":")]) {
        const parsed = c.parse(text);
        if ("steps" in parsed) {
          const written = parsed.steps.map((s) => s.text).join(";");
          typed.push({
            label: written,
            hint: c.describe(parsed.steps),
            why:
              parsed.steps.length === 1
                ? parsed.steps[0].spec.unavailable?.(parsed.steps[0].args)
                : undefined,
            run: () => c.run(parsed.steps),
          });
          break;
        }
      }
      if (!typed.length && q.includes(";")) {
        const parsed = c.parse(q);
        if ("error" in parsed)
          typed.push({
            label: q,
            hint: `Schritt ${parsed.step}`,
            why: parsed.error,
            run: () => this.announce(`Schritt ${parsed.step}: ${parsed.error}`),
          });
      }
      const number = /^(\S+?)[\s:-]+(\d{1,4})$/.exec(q);
      if (!typed.length && number) {
        // A number after a partial id: the first command that takes one.
        const hit = all.find(
          (e) =>
            fuzzy(number[1], e.text) >= 0 &&
            "steps" in c.parse(`${e.text.replace(/:\d+$/, "")}:${number[2]}`),
        );
        if (hit) {
          const text = `${hit.text.replace(/:\d+$/, "")}:${number[2]}`;
          const parsed = c.parse(text);
          if ("steps" in parsed)
            typed.push({
              label: text,
              hint: c.describe(parsed.steps),
              run: () => c.run(parsed.steps),
            });
        }
      }
    }
    const listed = all
      .filter((e) => !e.text.startsWith("goto:") || e.text === "goto:start")
      .map((e) => item(e.text, e.description, e.why))
      .map((i) => {
        // The id fuzzily; the German description by its words, costs and
        // keys left out, so «holz» finds Holzhacken, not every cost in wood.
        const words = plain((i.hint ?? "").split(" · ")[0]);
        const said = q && words.includes(plain(q)) ? 1 : -1;
        return { i, score: q ? Math.max(fuzzy(q, i.label), said) : 0 };
      })
      .filter((m) => m.score >= 0 && !typed.some((t) => t.label === m.i.label))
      .sort(
        (a, b) => b.score - a.score || Number(!!a.i.why) - Number(!!b.i.why),
      )
      .map((m) => m.i);
    return [...typed, ...listed];
  }

  /** How many buildings a repair command takes, and what it costs. */
  repairHint(list: Building[]): string {
    if (!list.length) return "nichts zu reparieren";
    const total: Cost = {};
    for (const b of list)
      for (const [key, n] of Object.entries(this.o.game.repairCost(b)) as [
        Good,
        number,
      ][])
        total[key] = (total[key] ?? 0) + n;
    const count = list.length === 1 ? "1 Gebäude" : `${list.length} Gebäude`;
    const cost = this.costText(total);
    return cost ? `${count} · ${cost}` : count;
  }

  /** Orders the repair of every building in a list the stock pays for, the most worn first. */
  repairAll(list: Building[]): string | void {
    const g = this.o.game;
    if (!list.length) return "Nichts zu reparieren.";
    let ordered = 0;
    let short = 0;
    for (const b of [...list].sort((a, c) => points(a) - points(c))) {
      if (!g.state.buildings.includes(b)) continue;
      if (g.repair(b)) short++;
      else ordered++;
    }
    const done =
      ordered === 1
        ? "Ein Gebäude wird repariert."
        : `${ordered} Gebäude werden repariert.`;
    this.announce(
      short ? `${done} Für ${short} weitere fehlen die Güter.` : done,
    );
  }

  /** Keeps the items that match what is typed, best first. */
  private filterFinder() {
    const f = this.finder;
    const query = f.input.value;
    f.shown = this.finderItems(query).slice(0, 200);
    f.selected = 0;
    f.list.replaceChildren(
      ...(f.shown.length
        ? f.shown.map((item, i) => {
            const option = el(
              "li",
              { id: `wg-finder-${i}`, className: "wg-finder-item" },
              el("span", {}, item.label),
              el(
                "span",
                { className: "wg-finder-hint" },
                item.why
                  ? `${item.hint ?? ""} – ${item.why}`
                  : (item.hint ?? ""),
              ),
            );
            if (item.why) option.classList.add("wg-finder-unavailable");
            option.setAttribute("role", "option");
            option.addEventListener("pointerdown", (event) => {
              event.preventDefault();
              this.runFinder(item);
            });
            return option;
          })
        : [
            el(
              "li",
              { className: "wg-finder-empty" },
              f.mode === ":" || query
                ? "Nichts passt."
                : "Noch nichts gefunden.",
            ),
          ]),
    );
    this.markFinder();
  }

  private markFinder() {
    const f = this.finder;
    f.list.querySelectorAll<HTMLElement>("[role=option]").forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === f.selected));
      if (i === f.selected) o.scrollIntoView({ block: "nearest" });
    });
    if (f.shown.length)
      f.input.setAttribute("aria-activedescendant", `wg-finder-${f.selected}`);
    else f.input.removeAttribute("aria-activedescendant");
  }

  private runFinder(item: FinderItem | undefined) {
    if (!item) return;
    // The building chosen when it opened stays chosen for the command.
    const chosen = this.chosen;
    this.closeFinder(true);
    this.chosen = chosen;
    try {
      item.run();
    } finally {
      this.chosen = undefined;
    }
  }

  menuAction(action: string) {
    const r = this.o.renderer;
    const box = this.mapHost().getBoundingClientRect();
    if (action === "home") {
      if (this.reading) this.leaveReading();
      r.centerOn(start.x + 0.5, start.y + 0.5);
      this.input?.follow({ x: start.x, y: start.y });
      this.o.moved();
    } else if (action === "zoom-in") {
      r.zoomAt(1.25, box.width / 2, box.height / 2);
      this.o.moved();
    } else if (action === "zoom-out") {
      r.zoomAt(0.8, box.width / 2, box.height / 2);
      this.o.moved();
    } else if (action === "saves") {
      this.o.saves();
    } else if (action === "keys") {
      this.o.keys();
    } else if (action === "reset") {
      void this.confirm({
        title: "Neu beginnen?",
        text: "Der Wald wächst nach, alle Gebäude und Vorräte gehen verloren. Gespeicherte Wälder und die Spielstände der Spiele bleiben.",
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
  costText(c: Cost): string {
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
            // The keyboard's click has no detail; a pointer's says which.
            const mode: PlaceMode =
              event.detail === 0
                ? "keys"
                : this.pointerKind === "mouse"
                  ? "mouse"
                  : "touch";
            this.startPlacing(kind, game, mode);
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
   * Starts placing a building. A slim card on it names it and its costs and
   * says why it cannot stand where it is. With the mouse it follows the
   * pointer and a click builds; with the keyboard it follows the cursor and
   * Enter builds; Escape stops either. Only by touch does the card carry
   * «Bauen» and ×, as the building is dragged or tapped into place.
   */
  private startPlacing(kind: Kind, game?: string, mode: PlaceMode = "touch") {
    if (this.reading) this.leaveReading();
    this.setDoomed(null);
    this.closeCard();
    this.placing = { kind, game, mode };
    this.mapHost().dataset.mode = "place";
    const text = this.placingText();
    const note = el("p", { className: "wg-card-note" });
    const build = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Bauen",
    );
    build.addEventListener("click", () => {
      if (this.placing?.at) this.place(this.placing.at);
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
        className:
          mode === "touch" ? "wg-place-card" : "wg-place-card wg-place-slim",
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
    } else if (mode === "keys" && this.keyCursor) {
      // Where the keyboard cursor is.
      this.ghostAt(this.keyCursor);
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
    const { note, build, mode } = this.placing;
    if (build) build.disabled = !spot.ok;
    if (note) {
      const ready: Record<PlaceMode, string> = {
        mouse: "Klick: bauen · Esc: abbrechen",
        keys: `${firstKey("enter")}: bauen · Esc: abbrechen`,
        touch: "",
      };
      const text = spot.ok ? ready[mode] : (spot.reason ?? "Hier nicht.");
      if (note.textContent !== text) note.textContent = text;
      note.hidden = !text;
    }
    this.o.world.moveCard({ x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 });
  }

  /** Builds the building being placed at a tile, or says why not. */
  private place(tile: Tile) {
    const why = this.tryPlace(tile);
    if (why) this.announce(why);
  }

  /** Builds the building being placed at a tile; returns why not, if not. */
  private tryPlace(tile: Tile): string | void {
    if (!this.placing) return;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, at.x, at.y);
    if (!spot.ok) return spot.reason ?? "Hier nicht.";
    const b = this.o.game.place(kind, game, at.x, at.y);
    if (!b) return this.o.game.unavailable(kind, game) ?? "Hier nicht.";
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
      // While somebody plays on the stage, its keys are the game's.
      key: (event, down) => {
        const on = this.playing();
        if (!on || this.placing || event.key === "Escape") return false;
        return on.stage.key(event, down);
      },
      keydown: (event) => {
        this.menuBack = this.mapHost();
        return this.dispatcher.keydown(event, "map");
      },
      keyup: (event) => this.dispatcher.keyup(event),
      blur: () => this.dispatcher.blur(),
      // With the saw, Holzhacken marks a dragged area; paving plans one.
      sawing: () =>
        ((this.tool === "fell" && this.o.game.state.tools.saw) ||
          this.tool === "pave") &&
        !this.placing &&
        !this.reading,
      grab: (tile) => {
        const p = this.placing;
        // Only by touch is it dragged; otherwise it follows pointer or cursor.
        if (!p?.at || p.kind === "damm" || p.mode !== "touch") return false;
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
          if (this.placing.mode !== "touch") return this.place(tile);
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
        if (this.placing?.mode === "mouse") this.ghostAt(tile);
      },
      saw: (from, to, done) => {
        // A drag that begins on a marked tree unmarks.
        this.unmarking = this.startsUnmarking(from);
        this.o.renderer.setSaw(
          done ? null : { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
          this.unmarking,
        );
        if (!done) return;
        // Holzhacken on one tile is a tap, as with the axe.
        if (this.tool === "fell" && from.x === to.x && from.y === to.y) {
          if (this.card) return this.closeCard();
          return this.activateTile(to);
        }
        this.sawArea(from, to);
      },
      cursor: (tile) => {
        this.keyCursor = tile;
        // In the text mode the text cursor shows instead.
        this.o.renderer.setCursor(this.textMode ? null : tile);
        if (this.placing) this.ghostAt(tile);
        if (this.sawFrom)
          this.o.renderer.setSaw(
            {
              x0: this.sawFrom.x,
              y0: this.sawFrom.y,
              x1: tile.x,
              y1: tile.y,
            },
            this.unmarking,
          );
      },
      cancel: () => {
        // In the text mode: out of the selection, then out of the mode.
        if (this.textMode) {
          if (!this.textMode.cursor.escape()) {
            this.stopTextMode();
            this.announce("Textmodus beendet.");
          }
          return;
        }
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

  // --- What the commands do (commandSet.ts) -----------------------------------------

  /** The keyboard cursor's tile, shown at the middle of the view if it was not. */
  private here(): Tile {
    return this.input?.here() ?? { x: start.x, y: start.y };
  }

  /** Moves the keyboard cursor (`left`, `right`, `up`, `down`). */
  moveCursor(direction: [number, number], by: number) {
    this.input?.move(direction, by);
  }

  zoom(factor: number) {
    this.input?.zoom(factor);
  }

  /**
   * What Enter does at the cursor (`enter`): place the building being
   * placed, start the text mode on a text read, begin or close an area with
   * paving or the saw, close a card, or act on the tile.
   */
  enter(): string | void {
    const tile = this.here();
    if (this.placing) return this.tryPlace(tile);
    // On the text read top-down, the key starts the text mode.
    const read = this.reading;
    if (
      read &&
      !read.stage &&
      this.o.game.textAt(tile.x, tile.y)?.key === read.id
    )
      return this.startTextMode(read.id as string);
    // Paving, and Holzhacken with the saw, begin an area with the key
    // and close it with the key again; an area begun with v closes too.
    const areas =
      this.tool === "pave" ||
      (this.tool === "fell" && this.o.game.state.tools.saw);
    if ((this.sawFrom || areas) && !this.reading) {
      if (!this.sawFrom) {
        this.beginArea(tile);
        this.announce(
          `${this.unmarking ? "Erste Ecke gesetzt, zum Entfernen der Markierungen" : "Erste Ecke gesetzt"}. Bewegen, dann ${firstKey("enter")} für die zweite.`,
        );
      } else this.closeArea(tile);
      return;
    }
    if (this.card) return this.closeCard();
    this.activateTile(tile);
  }

  /** Begins an area at the cursor (`selection:start`), choosing the saw if need be. */
  selectionStart(): string | void {
    if (this.placing || this.reading) return "Hier gibt es keine Auswahl.";
    if (this.tool !== "pave") {
      if (!this.o.game.state.tools.saw)
        return "Ohne Säge gibt es keine Auswahl.";
      if (this.tool !== "fell") this.setTool("fell");
    }
    this.beginArea(this.here());
    this.announce(
      `${this.unmarking ? "Auswahl zum Entfernen der Markierungen" : "Auswahl"}. Bewegen, ${firstKey("selection:other")} für die andere Ecke, dann ${firstKey("enter")}.`,
    );
  }

  /** The cursor jumps to the area's other corner (`selection:other`). */
  selectionOther(): string | void {
    const from = this.sawFrom;
    if (!from) return "Keine Auswahl.";
    this.sawFrom = this.here();
    this.input?.jump(from);
  }

  /** Closes the area at the cursor and applies it (`selection:confirm`). */
  selectionConfirm(): string | void {
    if (!this.sawFrom) return "Keine Auswahl.";
    this.closeArea(this.here());
  }

  /** Drops the area begun (`selection:cancel`). */
  selectionCancel() {
    this.sawFrom = null;
    this.o.renderer.setSaw(null);
  }

  /** Closes an area begun at a tile: marks, unmarks or paves it. */
  private closeArea(tile: Tile) {
    const from = this.sawFrom;
    if (!from) return;
    this.sawFrom = null;
    this.o.renderer.setSaw(null);
    // Holzhacken on one tile is a tap: it marks or unmarks one tree.
    if (this.tool === "fell" && from.x === tile.x && from.y === tile.y)
      return this.activateTile(tile);
    this.sawArea(from, tile);
  }

  /** Chooses a tool (`tool:…`); unlike its button, again keeps it. */
  chooseTool(tool: Tool) {
    if (tool === "none") {
      if (this.tool !== "none") this.setTool(this.tool);
      return;
    }
    if (this.tool !== tool) this.setTool(tool);
  }

  /** Opens or closes the build menu or the menu (`menu:…`). */
  toggleMenuNamed(name: "build" | "menu") {
    const button = need<HTMLButtonElement>(this.toolbox, `[data-open=${name}]`);
    this.toggleMenu(
      name === "build" ? this.buildMenu : this.mainMenu,
      button,
      this.menuBack ?? this.mapHost(),
    );
  }

  /** Runs an action of the text mode (`text:…`). */
  textRun(action: TextAction, count: number): string | void {
    if (!this.textMode) return "Nur im Textmodus.";
    if (!this.textMode.cursor.run(action, count)) return "";
  }

  /** The texts found, as choices for `goto:…`. */
  textChoices(): Choice[] {
    return this.o.game.hidden.filter(isFound).map((t) => ({
      value: slug(this.o.world.title(t)),
      label: this.o.world.title(t),
    }));
  }

  /** Turns the view onto a found text by its slug (`goto:…`). */
  readTextBySlug(value: string): string | void {
    const t = this.o.game.hidden
      .filter(isFound)
      .find((h) => slug(this.o.world.title(h)) === value);
    if (!t) return "Diese Schrift ist noch nicht gefunden.";
    this.readText(t);
  }

  /** The buildings the build menu shows, as choices for `build:…`. */
  buildChoices(): (Choice & { cost: string })[] {
    const g = this.o.game;
    return this.menuItems
      .filter((e) => g.shown(e.kind, e.game))
      .map((e) => ({
        value: slug(this.label(e.kind, e.game)),
        label: this.label(e.kind, e.game),
        cost: this.costText(kinds[e.kind].cost),
      }));
  }

  private buildEntry(value: string) {
    return this.menuItems.find(
      (e) =>
        this.o.game.shown(e.kind, e.game) &&
        slug(this.label(e.kind, e.game)) === value,
    );
  }

  buildUnavailable(value: string): string | undefined {
    const e = this.buildEntry(value);
    if (!e) return "Das gibt es noch nicht.";
    const why = this.o.game.unavailable(e.kind, e.game);
    return why && `${this.label(e.kind, e.game)}: ${why}`;
  }

  /** Starts placing a building at the keyboard cursor (`build:…`). */
  startBuilding(value: string): string | void {
    const e = this.buildEntry(value);
    if (!e) return "Das gibt es noch nicht.";
    this.here();
    this.startPlacing(e.kind, e.game, "keys");
  }

  /**
   * The building commands act on (`repair:chosen`): the one chosen when the
   * finder opened, the open card's, or the one under the keyboard cursor.
   */
  chosenBuilding(): Building | undefined {
    const cursor = this.input?.cursor();
    const b =
      this.chosen ??
      this.card?.b ??
      (cursor ? this.o.game.buildingAt(cursor.x, cursor.y) : undefined);
    return b && this.o.game.state.buildings.includes(b) ? b : undefined;
  }

  nameOf(b: Building): string {
    return this.label(b.kind, b.game);
  }

  /** How many ruins can be cleared away, for `clear:ruins`. */
  ruinsHint(): string {
    const g = this.o.game;
    const ruins = g.state.buildings.filter(
      (b) => b.state === "ruin" && !b.clearing,
    );
    const near = ruins.filter((b) => g.canDemolish(b));
    return !ruins.length
      ? "keine Ruinen"
      : !near.length
        ? "kein Recyclinghof in der Nähe"
        : `${near.length === 1 ? "1 Ruine" : `${near.length} Ruinen`} · viel Arbeit`;
  }

  /** Clears away the ruins a Recyclinghof is near (`clear:ruins`). */
  clearRuins(): string | void {
    const g = this.o.game;
    const ruins = g.state.buildings.filter(
      (b) => b.state === "ruin" && !b.clearing,
    );
    if (!ruins.length) return "Es gibt keine Ruinen.";
    const near = ruins.filter((b) => g.canDemolish(b));
    for (const b of near) g.demolish(b);
    const far = ruins.length - near.length;
    const cleared =
      near.length === 1
        ? "Die Waldleute räumen eine Ruine weg."
        : `Die Waldleute räumen ${near.length} Ruinen weg.`;
    this.announce(
      [
        near.length ? cleared : "",
        far
          ? `Für ${far === 1 ? "eine Ruine" : `${far} Ruinen`} braucht es einen Recyclinghof im Umkreis von 10 km.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (!near.length) return "";
  }

  /**
   * Starts or stops recording a macro (`macro:record`); stopped, it asks
   * for a name to keep it by.
   */
  toggleRecording() {
    const c = this.o.commands;
    if (!c.isRecording) {
      c.startRecording();
      this.announce(
        `Aufnahme läuft. Jeder Befehl wird mitgeschrieben; ${firstKey("macro:record")} beendet sie.`,
      );
      return;
    }
    const steps = c.stopRecording();
    if (!steps) return this.announce("Aufnahme beendet, nichts aufgenommen.");
    this.nameMacro(steps);
  }

  /** Asks for a name for a macro just recorded; without, it stays the last. */
  private nameMacro(steps: string) {
    const d = need<HTMLDialogElement>(this.o.root, "[data-macro-name]");
    const input = need<HTMLInputElement>(d, "[data-macro-name-input]");
    const status = need(d, "[data-macro-name-status]");
    need(d, "[data-macro-name-steps]").textContent = steps;
    input.value = "";
    status.textContent = "";
    d.returnValue = "";
    const save = need<HTMLButtonElement>(d, "[data-macro-name-save]");
    const check = (event: Event) => {
      const name = slug(input.value);
      const why = name ? macroName(name) : "Gib einen Namen.";
      if (!why) return;
      event.preventDefault();
      status.textContent = why;
      input.focus();
    };
    save.addEventListener("click", check);
    d.addEventListener(
      "close",
      () => {
        save.removeEventListener("click", check);
        const name = slug(input.value);
        if (d.returnValue === "save" && name && !macroName(name)) {
          setMacro(name, steps);
          this.announce(
            `Makro «${name}» gespeichert. Es läuft mit :macro:run:${name} und lässt sich unter «Tasten» binden.`,
          );
        } else
          this.announce(
            `Aufnahme beendet. ${firstKey("macro:replay")} spielt sie ab.`,
          );
        this.mapHost().focus({ preventScroll: true });
      },
      { once: true },
    );
    d.showModal();
    input.focus();
  }

  /** Whether an area of Holzhacken beginning on a tile unmarks: a marked tree. */
  private startsUnmarking(tile: Tile): boolean {
    return this.tool === "fell" && this.o.game.isMarked(tile.x, tile.y);
  }

  /** Begins an area with the keyboard at a tile. */
  private beginArea(tile: Tile) {
    this.sawFrom = tile;
    this.unmarking = this.startsUnmarking(tile);
    this.o.renderer.setSaw(
      { x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y },
      this.unmarking,
    );
  }

  /**
   * A selected area: Holzhacken marks its trees, or, begun on a marked tree,
   * unmarks them; paving plans its free tiles.
   */
  private sawArea(from: Tile, to: Tile) {
    if (this.tool === "pave") {
      const count = this.o.game.paveArea(from.x, from.y, to.x, to.y);
      return this.announce(
        count === 1
          ? "Ein Feld wird gepflastert."
          : `${count} Felder werden gepflastert.`,
      );
    }
    if (this.unmarking) {
      const count = this.o.game.unmarkArea(from.x, from.y, to.x, to.y);
      return this.announce(
        count === 1
          ? "Eine Markierung entfernt."
          : `${count} Markierungen entfernt.`,
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
      if (this.tool !== "fell") this.setTool("fell");
      this.items();
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
    if (this.tool === "repair") {
      if (b) this.repair(b);
      else this.announce("Tippe auf ein Gebäude, das repariert werden soll.");
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
    // A found text: unless Holzhacken marks one of its trees, read it.
    if (
      text &&
      isFound(text) &&
      !(this.tool === "fell" && g.isTree(tile.x, tile.y))
    )
      return this.readText(text);
    if (this.tool === "fell") {
      const result = g.toggleMark(tile.x, tile.y);
      if (result === "marked") this.announce("Baum markiert.");
      else if (result === "unmarked") this.announce("Markierung entfernt.");
    }
  }

  // --- Buildings react directly ---------------------------------------------------

  /**
   * A tap on a building: play on the stage, open the game or its source,
   * set a crew, repair it or clear its ruin away, or show how it is doing.
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
    if (!removed) this.repairTool();
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  private stateText(b: Building): string {
    const g = this.o.game;
    const s = g.state;
    if (b.state === "drowned") return "überflutet.";
    if (b.state === "ruin")
      return "eine Ruine. Hier geht nichts mehr, und sie drückt auf die Stimmung.";
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
      case "recyclinghof":
        return "was im Umkreis von 10 km abgerissen wird, gibt hier einen Teil zurück.";
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
    const why = this.o.game.undemolishable(b);
    if (why) {
      this.setDoomed(null);
      this.o.world.toast(b, why);
      return this.announce(why);
    }
    const g = this.o.game;
    const name = this.label(b.kind, b.game);
    if (this.doomed?.id !== b.id) {
      const refund = this.costText(g.refund(b));
      this.setDoomed(b);
      const text =
        b.state === "ruin"
          ? `Nochmals tippen: Ruine ${name} wegräumen (viel Arbeit, nichts zurück).`
          : refund
            ? `Nochmals tippen: ${name} abreissen (${refund} zurück).`
            : b.state === "site"
              ? `Nochmals tippen: ${name} abreissen (nichts zurück).`
              : `Nochmals tippen: ${name} abreissen (nichts zurück, kein Recyclinghof in der Nähe).`;
      this.o.world.toast(b, text);
      return this.announce(text);
    }
    this.setDoomed(null);
    const result = g.demolish(b);
    this.announce(
      result === "clearing"
        ? `Die Waldleute räumen die Ruine ${name} weg.`
        : `${name} abgerissen.`,
    );
  }

  /** Orders a building's repair, and says so. */
  repair(b: Building) {
    const g = this.o.game;
    const name = this.label(b.kind, b.game);
    const cost = this.costText(g.repairCost(b));
    const why = g.repair(b);
    const text = why ?? `${name} wird repariert${cost ? ` (${cost})` : ""}.`;
    this.o.world.toast(b, text);
    this.announce(text);
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
    // A cursor outside the area, as after a jump with «/», goes where the
    // view looks, before the view moves clear of the bars; one on it stays.
    const look = { x: Math.floor(area.x + area.w / 2), y: Math.floor(y) };
    const at = this.input?.cursor();
    if (
      at &&
      !(
        at.x >= area.x &&
        at.x < area.x + area.w &&
        at.y >= area.y &&
        at.y < area.y + area.h
      )
    )
      this.input?.follow(look);
    y += shift / zoom;
    this.reading = {
      id,
      stage,
      back: this.reading?.back ?? { ...r.camera },
      zoom,
      cursor: this.reading ? this.reading.cursor : (at ?? null),
    };
    r.flyTo({ x: area.x + area.w / 2, y, zoom, plan: 1 });
    this.backBar.hidden = false;
    this.o.moved();
    this.stopTextMode();
    // With the keyboard on a text, the key that applies starts the text mode.
    if (!stage && this.input?.cursor())
      what += ` ${firstKey("enter")} auf der Schrift: Textmodus.`;
    this.announce(`${what} Escape oder «Zurück zur Karte» kehrt zurück.`);
  }

  /**
   * The text mode on the text read top-down: the keyboard cursor becomes a
   * text cursor (textCursor.ts) until Escape.
   */
  private startTextMode(key: string) {
    const inks = this.o.world.inks(key);
    if (!inks || this.textMode) return;
    this.textMode = {
      cursor: new TextCursor({
        light: inks.light,
        dark: inks.dark,
        announce: (text) => this.announce(text),
        reveal: (box) => this.reveal(box),
      }),
      shown: false,
    };
    this.o.renderer.setCursor(null);
    const k = letterKey;
    this.announce(
      `Textmodus: ${k("text:left")} ${k("text:down")} ${k("text:up")} ${k("text:right")}, ${k("text:word-next")}, ${k("text:word-back")} und ${k("text:word-end")} bewegen, ${k("text:select")} und ${k("text:select-line")} wählen aus, ${k("text:copy")} kopiert. Escape beendet ihn.`,
    );
  }

  private stopTextMode() {
    if (!this.textMode) return;
    this.textMode.cursor.destroy();
    this.textMode = null;
    this.o.renderer.setCursor(this.input?.cursor() ?? null);
  }

  /**
   * Pans the plan so that a box on the screen, the text cursor, stays clear
   * of the back button and the toolbox; past an edge, by a good stretch.
   */
  private reveal(box: DOMRect) {
    const host = this.mapHost().getBoundingClientRect();
    const top = host.top + 90;
    const bottom = host.bottom - 110;
    const left = host.left + 24;
    const right = host.right - 24;
    const dy =
      box.bottom > bottom
        ? host.top + host.height * 0.55 - box.top
        : box.top < top
          ? host.top + host.height * 0.45 - box.bottom
          : 0;
    const dx =
      box.right > right
        ? right - box.right
        : box.left < left
          ? left - box.left
          : 0;
    if (!dx && !dy) return;
    this.o.renderer.pan(dx, dy);
    this.o.moved();
  }

  /**
   * Turns the view back to the map: to where it was, or, after zooming out
   * of the text, from where and how high the view is now.
   */
  private leaveReading(zoomedOut = false) {
    if (!this.reading) return;
    const { back, cursor } = this.reading;
    this.reading = null;
    this.stopTextMode();
    this.o.stage()?.stage.release();
    this.backBar.hidden = true;
    const r = this.o.renderer;
    // The cursor stays. Where it was when the view turned, the view turns
    // back to where it was; moved there, as by a jump with «/», onto it.
    const now = this.input?.cursor();
    const moved = now && (now.x !== cursor?.x || now.y !== cursor?.y);
    this.o.renderer.flyTo(
      zoomedOut
        ? { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom, plan: 0 }
        : moved
          ? { x: now.x + 0.5, y: now.y + 0.5, zoom: back.zoom, plan: 0 }
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

  /** Asks first, in a modal dialog; true for yes. */
  confirm(o: { title: string; text: string; yes: string }): Promise<boolean> {
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
