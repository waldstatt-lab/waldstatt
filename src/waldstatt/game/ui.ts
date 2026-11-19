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
import { BuildMenu } from "./buildMenu";
import { describeKeys } from "./keysHelp";
import { BuildingCard } from "./card";
import { Finder } from "./finder";
import { el, need } from "./dom";
import {
  goodKeys,
  goodName,
  kinds,
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
import { most, points } from "./wear";
import { damSite, start } from "./world";

/** «fell» is Holzhacken: the axe, upgraded to the saw once it is found. */
type Tool = "none" | "fell" | "pave" | "repair" | "demolish";
type PlaceMode = "mouse" | "keys" | "touch";

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
  /** Opens the scripts. */
  scripts(): void;
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
  /** The card over a tapped building (card.ts). */
  private cards: BuildingCard;
  /** The card open, if any. */
  get card() {
    return this.cards.current;
  }
  private live: HTMLElement;
  private confirmDialog: HTMLDialogElement;
  /** The finders «/» and «:» (finder.ts). */
  private finder: Finder;
  /** The build menu's pictures and buttons (buildMenu.ts). */
  private build: BuildMenu;
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
    this.finder = new Finder(root, {
      commands: o.commands,
      announce: (text) => this.announce(text),
      focusMap: () => this.mapHost().focus({ preventScroll: true }),
    });
    this.dispatcher = new Dispatcher(o.commands, {
      contexts: () => this.contexts(),
      status: (count, keys) => this.showStatus(count, keys),
      pan: (dx, dy, dt) => this.input?.pan(dx, dy, dt),
      announce: (text) => this.announce(text),
    });
    o.commands.onChange(() => this.showStatus());
    this.cards = new BuildingCard({
      game: o.game,
      world: o.world,
      dispatcher: this.dispatcher,
      announce: (text) => this.announce(text),
      label: (kind, game) => this.label(kind, game),
      costText: (c) => this.costText(c),
      repair: (b) => this.repair(b),
      focusMap: () => this.mapHost().focus({ preventScroll: true }),
    });
    this.attachShortcuts();
    // Ctrl+C copies the text mode's selection, as y does.
    document.addEventListener("copy", (event) => {
      const text = this.textMode?.cursor.selectedText();
      if (!text || document.activeElement !== this.mapHost()) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      this.announce("Kopiert.");
    });
    describeKeys(this.o.root);
    onKeysChange(() => {
      describeKeys(this.o.root);
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
        this.cards.close();
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
    this.build = new BuildMenu({
      game: o.game,
      games: o.games,
      menu: this.buildMenu,
      announce: (text) => this.announce(text),
      label: (kind, game) => this.label(kind, game),
      gameTitle: (id) => this.gameTitle(id),
      closeMenus: () => this.closeMenus(),
      pointerKind: () => this.pointerKind,
      startPlacing: (kind, game, mode) => this.startPlacing(kind, game, mode),
    });
    this.items();
    this.unlocked();
  }

  /** Something appeared in the build menu: the Bauen button shows it. */
  unlocked() {
    need(this.toolbox, "[data-fresh]").hidden = !this.o.game.state.fresh;
    if (!this.buildMenu.hidden) this.build.update();
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
  /** Repairs the building of the open card (`card:repair`); why not, if not. */
  repairCard(): string | undefined {
    return this.cards.repair();
  }

  /** Puts one Waldmensch more or fewer into the building of the open card. */
  stepCrew(by: number) {
    this.cards.stepCrew(by);
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
    if (!this.buildMenu.hidden) this.build.update();
    this.cards.update();
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
      this.build.update();
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
   * Keys anywhere on the page, as long as nothing else takes them (a text
   * field, a dialog, the finder, or the stage while somebody plays): the
   * commands that work anywhere, such as the tools, menus and finders.
   */
  private attachShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, dialog[open], a")) return;
      if (this.finder.isOpen || this.reading?.stage) return;
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

  /** Opens the finder: «/» for the texts found, «:» for commands. */
  openFinder(mode: "/" | ":") {
    this.closeMenus();
    // The building chosen: the one whose card is open, or under the cursor.
    const cursor = this.keyCursor;
    const chosen =
      this.card?.b ??
      (cursor ? this.o.game.buildingAt(cursor.x, cursor.y) : undefined);
    this.cards.close();
    this.finder.open(mode, chosen);
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

  /**
   * Orders the repair of every building in a list the stock pays for, the
   * most worn first; returns why not, or those ordered. That none could be
   * paid for is a why not, so a script does not go on as if repaired.
   */
  repairAll(list: Building[]): string | Building[] {
    const g = this.o.game;
    const done: Building[] = [];
    let short = 0;
    let why: string | undefined;
    for (const b of [...list].sort((a, c) => points(a) - points(c))) {
      if (!g.state.buildings.includes(b)) continue;
      const not = g.repair(b);
      if (not) {
        short++;
        why ??= not;
      } else done.push(b);
    }
    if (!done.length)
      return short === 1 && why
        ? why
        : short
          ? `Für keine der ${short} Reparaturen reichen die Güter.`
          : "Nichts zu reparieren.";
    const ordered = done.length;
    const said =
      ordered === 1
        ? "Ein Gebäude wird repariert."
        : `${ordered} Gebäude werden repariert.`;
    this.announce(
      short ? `${said} Für ${short} weitere fehlen die Güter.` : said,
    );
    return done;
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
    } else if (action === "scripts") {
      this.o.scripts();
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
    this.cards.close();
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
        if (this.card) return this.cards.close();
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
          if (this.card) return this.cards.close();
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
        else if (this.card) this.cards.close();
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

  /** The keyboard cursor's tile, or the middle of the view, for queries. */
  cursorTile(): Tile {
    const cursor = this.input?.cursor();
    if (cursor) return cursor;
    const box = this.mapHost().getBoundingClientRect();
    const t = this.o.renderer.screenToTile(box.width / 2, box.height / 2);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /** The tool chosen, as the `tool:` commands name it, or null. */
  toolName(): string | null {
    const names: Record<Tool, string | null> = {
      none: null,
      fell: "holzhacken",
      pave: "pflastern",
      repair: "reparieren",
      demolish: "abreissen",
    };
    return names[this.tool];
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
    if (this.card) return this.cards.close();
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
    return this.build.items
      .filter((e) => g.shown(e.kind, e.game))
      .map((e) => ({
        value: slug(this.label(e.kind, e.game)),
        label: this.label(e.kind, e.game),
        cost: this.costText(kinds[e.kind].cost),
      }));
  }

  private buildEntry(value: string) {
    return this.build.items.find(
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
      this.finder.chosen ??
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

  /**
   * Clears away the ruins a Recyclinghof is near (`clear:ruins`); returns
   * why not, or those being cleared.
   */
  clearRuins(): string | Building[] {
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
    return near;
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
      if (!g.economy.open(b)) return this.cards.open(b);
      return this.readStage(b);
    }
    const game = this.o.games.find((x) => x.id === b.game);
    if (b.state === "done" && game && b.kind === "spielhaus") {
      if (!g.economy.open(b)) return this.cards.open(b);
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
    this.cards.open(b);
  }

  /** Called when something on a building changes. */
  building(b: Building, removed: boolean) {
    if (removed && this.doomed?.id === b.id) this.setDoomed(null);
    if (removed && this.reading?.id === b.id) this.leaveReading();
    if (removed && this.card?.b.id === b.id) this.cards.close();
    if (!removed) this.repairTool();
    if (!this.buildMenu.hidden) this.build.update();
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

  /** Orders a building's repair, and says so; returns why not, if not. */
  repair(b: Building): string | undefined {
    const g = this.o.game;
    const name = this.label(b.kind, b.game);
    const cost = this.costText(g.repairCost(b));
    const why = g.repair(b);
    const text = why ?? `${name} wird repariert${cost ? ` (${cost})` : ""}.`;
    this.o.world.toast(b, text);
    this.announce(text);
    return why;
  }

  /**
   * Places a building at the keyboard cursor in one step (`place:…`), for
   * scripts and keys: no placing mode. Returns why not, or the site.
   */
  placeAt(value: string): string | Building {
    const e = this.buildEntry(value);
    if (!e) return "Das gibt es noch nicht.";
    const g = this.o.game;
    const why = g.unavailable(e.kind, e.game);
    if (why) return `${this.label(e.kind, e.game)}: ${why}`;
    const tile = this.here();
    const { w, h } = g.size(e.kind);
    const at = { x: tile.x - Math.floor(w / 2), y: tile.y - Math.floor(h / 2) };
    const spot = g.placement(e.kind, at.x, at.y);
    if (!spot.ok) return spot.reason ?? "Hier nicht.";
    const b = g.place(e.kind, e.game, at.x, at.y);
    if (!b) return g.unavailable(e.kind, e.game) ?? "Hier nicht.";
    return b;
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
    if (!this.buildMenu.hidden) this.build.update();
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
