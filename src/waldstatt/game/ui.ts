/**
 * The HTML interface over the map: the toolbox with supplies and tools
 * (axe, saw, tearing down), the build menu, placing buildings, the
 * Waldmensch's hints and the announcements for screen readers. Things on the
 * map react directly, without panels or dialogs: a text, a Spielhaus plate or
 * the stage turns the view top-down onto it, other buildings show a short
 * status label, and tearing down takes a second tap. Only «Neu beginnen» in
 * the menu asks first. Nodes are created with the DOM API, never from HTML
 * strings.
 */
import { balance, groups, kinds, STAGE, type Kind } from "./config";
import type { MapHandlers, Tile } from "./input";
import { PLAN } from "./iso";
import type { WorldLayer } from "./overlay";
import type { Renderer } from "./render";
import { hints, type Game } from "./sim";
import { STAGE_RES, type Stage } from "./stage";
import type { Building } from "./state";
import type { GameInfo } from "./texts";
import { damSite } from "./world";

type Tool = "none" | "axe" | "saw" | "demolish";

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

/** The largest zoom for reading, so text stays a comfortable size. */
const readingZoom = 1.2;

export class Ui {
  private tool: Tool = "none";
  private placing: { kind: Kind; game?: string; at?: Tile } | null = null;
  private sawFrom: Tile | null = null;
  /** The building torn down by the next tap with the Abreissen tool. */
  private doomed: Building | null = null;
  /** While reading or playing: the building, and where the camera was. */
  private reading: {
    b: Building;
    back: { x: number; y: number; zoom: number };
    /** The closest zoom so far; zooming out from it leads back to the map. */
    zoom: number;
  } | null = null;
  private suppliesDirty = true;

  private toolbox: HTMLElement;
  private buildMenu: HTMLElement;
  private mainMenu: HTMLElement;
  private placingBar: HTMLElement;
  private backBar: HTMLElement;
  private hint: HTMLElement;
  private live: HTMLElement;
  private confirmDialog: HTMLDialogElement;
  private menuItems: {
    kind: Kind;
    game?: string;
    button: HTMLButtonElement;
    about: HTMLElement;
  }[] = [];

  constructor(private o: UiOptions) {
    const root = o.root;
    this.toolbox = need(root, "[data-toolbox]");
    this.buildMenu = need(root, "[data-build-menu]");
    this.mainMenu = need(root, "[data-main-menu]");
    this.placingBar = need(root, "[data-placing]");
    this.backBar = need(root, "[data-back]");
    this.hint = need(root, "[data-hint]");
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
    need(this.hint, "[data-hint-close]").addEventListener("click", () => {
      o.game.state.hint = o.game.currentHint() + 1;
      this.hint.hidden = true;
      o.moved();
      this.mapHost().focus();
    });
    need(this.placingBar, "[data-place-here]").addEventListener("click", () => {
      if (this.placing?.at) this.tryPlace(this.placing.at);
    });
    need(this.placingBar, "[data-place-cancel]").addEventListener("click", () =>
      this.stopPlacing(),
    );
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
      } else if (this.placing) {
        this.stopPlacing();
      } else if (this.reading) {
        this.leaveReading();
      }
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
    this.updateHint();
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
      // Zooming in is fine; any zooming out turns back to the map.
      this.reading.zoom = Math.max(this.reading.zoom, r.camera.zoom);
      if (r.camera.zoom < this.reading.zoom * 0.97) this.leaveReading(true);
    }
    if (!this.suppliesDirty) return;
    this.suppliesDirty = false;
    const s = this.o.game.state;
    const values: Record<string, string> = {
      wood: String(s.wood),
      parchment: String(s.parchment),
      prints: String(s.prints),
      workers: String(this.o.game.workers.length),
    };
    for (const element of this.toolbox.querySelectorAll<HTMLElement>(
      "[data-supply]",
    ))
      element.textContent = values[element.dataset.supply ?? ""] ?? "";
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  // --- Tools and menus ------------------------------------------------------

  setTool(tool: Tool) {
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
    if (this.tool === "axe")
      this.announce("Axt: Bäume antippen, die fallen sollen.");
    if (this.tool === "saw")
      this.announce("Säge: über die Bäume ziehen, die fallen sollen.");
    if (this.tool === "demolish")
      this.announce(
        "Abreissen: ein Gebäude zweimal antippen. Die Hälfte des Holzes kommt zurück.",
      );
  }

  private toggleMenu(menu: HTMLElement, button: HTMLButtonElement) {
    const open = menu.hidden;
    this.closeMenus();
    if (!open) return;
    if (menu === this.buildMenu) this.updateBuildMenu();
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
      r.centerOn(0.5, 0.5);
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
      }).then((yes) => yes && this.o.reset());
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

  private costText(kind: Kind): string {
    const c = kinds[kind].cost;
    const parts = [`${c.wood} Holz`];
    if (c.parchment) parts.push(`${c.parchment} Pergament`);
    if (c.prints) parts.push(`${c.prints} Drucke`);
    return parts.join(", ");
  }

  /** Builds the menu once; updateBuildMenu() keeps it current in place. */
  private renderBuildMenu() {
    const list = need(this.buildMenu, "[data-build-list]");
    list.replaceChildren();
    this.menuItems = [];
    for (const group of groups) {
      const items = el("ul", { className: "wg-build-items" });
      for (const [kind, info] of Object.entries(kinds) as [
        Kind,
        (typeof kinds)[Kind],
      ][]) {
        if (info.group !== group) continue;
        const games =
          info.limit === "game" ? this.o.games.map((g) => g.id) : [undefined];
        for (const game of games) {
          const about = el("span", { className: "wg-build-about" });
          const button = el(
            "button",
            { type: "button", className: "wg-build-item" },
            el("span", { className: "wg-build-name" }, this.label(kind, game)),
            el("span", { className: "wg-build-cost" }, this.costText(kind)),
            about,
          );
          button.dataset.build = `${kind}:${game ?? ""}`;
          button.addEventListener("click", () => {
            const why = this.o.game.unavailable(kind, game);
            if (why) return this.announce(why);
            this.closeMenus();
            this.startPlacing(kind, game);
          });
          items.append(el("li", {}, button));
          this.menuItems.push({ kind, game, button, about });
        }
      }
      list.append(
        el("li", {}, el("h3", { className: "wg-build-group" }, group), items),
      );
    }
    this.updateBuildMenu();
  }

  /** Updates availability and reasons without touching scroll or focus. */
  private updateBuildMenu() {
    for (const item of this.menuItems) {
      const reason = this.o.game.unavailable(item.kind, item.game);
      const text = reason ?? kinds[item.kind].about;
      if (item.about.textContent !== text) item.about.textContent = text;
      if (reason) item.button.setAttribute("aria-disabled", "true");
      else item.button.removeAttribute("aria-disabled");
    }
  }

  // --- Placing ----------------------------------------------------------------

  private startPlacing(kind: Kind, game?: string) {
    if (this.reading) this.leaveReading();
    this.setDoomed(null);
    this.placing = { kind, game };
    this.mapHost().dataset.mode = "place";
    const name = this.label(kind, game);
    let text = `${name} platzieren: auf freien Boden tippen oder klicken.`;
    if (kind === "bruecke")
      text = `${name}: auf einen Fluss tippen. Sie reicht von Ufer zu Ufer.`;
    if (kind === "hafen") text = `${name}: an das Ufer eines Sees setzen.`;
    if (kind === "schiff")
      text = `${name}: aufs Wasser neben einen fertigen Hafen setzen.`;
    if (kind === "damm") {
      const drowned = this.o.game.wouldDrown();
      text = `${name}: nur dort, wo die Sihl das Tal verlässt. Blau wird der Sihlsee`;
      text += drowned.length
        ? ` – darin gehen unter: ${drowned.map((b) => this.label(b.kind, b.game)).join(", ")}.`
        : ".";
    }
    need(this.placingBar, "[data-placing-text]").textContent = text;
    this.placingBar.hidden = false;
    const r = this.o.renderer;
    if (kind === "damm") {
      // Far enough out to see the dam and most of the future lake.
      r.setLakePreview(true);
      r.camera.zoom = r.clampZoom(Math.min(r.camera.zoom, 1.25));
      r.centerOn(damSite.x + damSite.w / 2 + 6, damSite.y + 9);
      this.o.moved();
      this.ghostAt({ x: damSite.x, y: damSite.y });
    } else {
      const box = this.mapHost().getBoundingClientRect();
      const centre = r.screenToTile(box.width / 2, box.height / 2);
      this.ghostAt({ x: Math.floor(centre.x), y: Math.floor(centre.y) });
    }
    this.announce(
      `${text} Mit Pfeiltasten verschieben, Eingabetaste baut, Escape bricht ab.`,
    );
    this.mapHost().focus();
  }

  private anchor(tile: Tile): Tile {
    if (!this.placing) return tile;
    const { w, h } = this.o.game.size(this.placing.kind, this.placing.game);
    return { x: tile.x - Math.floor(w / 2), y: tile.y - Math.floor(h / 2) };
  }

  private ghostAt(tile: Tile) {
    if (!this.placing) return;
    this.placing.at = tile;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, game, at.x, at.y);
    this.o.renderer.setGhost(spot, { kind, game });
    need<HTMLButtonElement>(this.placingBar, "[data-place-here]").disabled =
      !spot.ok;
    need(this.placingBar, "[data-placing-reason]").textContent = spot.ok
      ? ""
      : (spot.reason ?? "");
  }

  private tryPlace(tile: Tile) {
    if (!this.placing) return;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, game, at.x, at.y);
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
    this.placingBar.hidden = true;
    this.o.renderer.setGhost(null);
    this.o.renderer.setLakePreview(false);
    this.mapHost().dataset.mode = this.tool;
  }

  // --- Map handlers -------------------------------------------------------------

  /** The stage, while the view is turned onto the theatre. */
  private playing() {
    if (this.reading?.b.kind !== "theater") return null;
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
        if (result.open) window.location.href = result.open;
        return result.handled;
      },
      release: () => this.o.stage()?.stage.release(),
      key: (event, down) => {
        const on = this.playing();
        if (!on || this.placing || event.key === "Escape") return false;
        return on.stage.key(event, down);
      },
      sawing: () => this.tool === "saw" && !this.placing && !this.reading,
      tap: (tile, pointer) => {
        if (this.placing) {
          if (pointer === "mouse") this.tryPlace(tile);
          else this.ghostAt(tile);
          return;
        }
        this.activateTile(tile);
      },
      hover: (tile) => {
        if (this.placing) this.ghostAt(tile);
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
        if (this.tool === "saw" && !this.reading) {
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
        this.activateTile(tile);
      },
      cancel: () => {
        if (this.sawFrom) {
          this.sawFrom = null;
          this.o.renderer.setSaw(null);
        } else if (this.placing) this.stopPlacing();
        else if (this.reading) this.leaveReading();
        else if (this.doomed) this.setDoomed(null);
        else if (this.tool !== "none") this.setTool(this.tool);
      },
      moved: () => this.o.moved(),
    };
  }

  private sawArea(from: Tile, to: Tile) {
    const count = this.o.game.markArea(from.x, from.y, to.x, to.y);
    this.announce(
      count === 1 ? "Ein Baum markiert." : `${count} Bäume markiert.`,
    );
  }

  private activateTile(tile: Tile) {
    const g = this.o.game;
    const b = g.buildingAt(tile.x, tile.y);
    if (this.reading && b?.id === this.reading.b.id) return;
    if (this.tool === "demolish") {
      if (b) this.demolish(b);
      else {
        this.setDoomed(null);
        this.announce("Tippe auf ein Gebäude, das weg soll.");
      }
      return;
    }
    if (b) return this.react(b);
    if (this.tool === "axe") {
      const result = g.toggleMark(tile.x, tile.y);
      if (result === "marked") this.announce("Baum markiert.");
      else if (result === "unmarked") this.announce("Markierung entfernt.");
      return;
    }
    if (this.tool === "none" && g.isTree(tile.x, tile.y))
      this.announce("Nimm die Axt oder die Säge, um Bäume zu markieren.");
  }

  // --- Buildings react directly ---------------------------------------------------

  private readable(b: Building): boolean {
    return (
      b.state === "done" &&
      (!!kinds[b.kind].fit || b.kind === "theater" || b.kind === "spielhaus")
    );
  }

  /** A tap on a building: read it, or show how it is doing. */
  private react(b: Building) {
    if (this.readable(b)) return this.read(b);
    const text = this.stateText(b);
    this.o.world.toast(b, `${this.label(b.kind, b.game)}: ${text}`);
    this.announce(`${this.label(b.kind, b.game)}: ${text}`);
  }

  /** Called when something on a building changes; nothing to refresh here. */
  building(b: Building, removed: boolean) {
    if (removed && this.doomed?.id === b.id) this.setDoomed(null);
    if (removed && this.reading?.b.id === b.id) this.leaveReading();
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  private stateText(b: Building): string {
    const info = kinds[b.kind];
    if (b.state === "drowned") return "überflutet.";
    if (b.state === "site") {
      const percent = Math.round(this.o.game.progress(b) * 100);
      return percent === 0 ? "Baustelle." : `im Bau, ${percent} %.`;
    }
    const texts: Partial<Record<Kind, string>> = {
      huette: "hier wohnt ein Waldmensch.",
      schafweide: `Pergament ${this.o.game.state.parchment} von ${balance.maxParchment}.`,
      druckerei: `Drucke ${this.o.game.state.prints} von ${balance.maxPrints}.`,
      kloster: "der Stolz der Waldstatt.",
      damm: "staut die Sihl zum Sihlsee.",
      bruecke: "hier kommen die Waldleute über den Fluss.",
      hafen: this.portText(b),
      schiff: "fährt die Waldleute zu den anderen Häfen am See.",
    };
    return texts[b.kind] ?? info.about;
  }

  private portText(b: Building): string {
    const { ports, ships } = this.o.game.harbour(b);
    if (!ships) return "noch liegt kein Schiff hier. Bau eines.";
    if (ports < 2) return "die Schiffe brauchen einen zweiten Hafen am See.";
    return ships === 1
      ? "ein Schiff fährt über diesen See."
      : `${ships} Schiffe fahren über diesen See.`;
  }

  /** The Abreissen tool: the first tap marks a building, the second tears it down. */
  private demolish(b: Building) {
    if (!this.o.game.canDemolish(b)) {
      this.setDoomed(null);
      return this.announce(
        b.state === "drowned"
          ? "Das liegt unter Wasser."
          : "Der Damm bleibt stehen.",
      );
    }
    const name = this.label(b.kind, b.game);
    if (this.doomed?.id !== b.id) {
      const refund = Math.floor(kinds[b.kind].cost.wood * balance.refund);
      this.setDoomed(b);
      const text = `Nochmals tippen: ${name} abreissen (${refund} Holz zurück).`;
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

  /** Turns the view top-down onto a text, a plate or the stage. */
  private read(b: Building) {
    const r = this.o.renderer;
    const area =
      b.kind === "theater"
        ? {
            x: b.x + STAGE.u0,
            y: b.y + STAGE.v0,
            w: STAGE.u1 - STAGE.u0,
            h: STAGE.v1 - STAGE.v0,
          }
        : (this.o.world.area(b.id) ?? { x: b.x, y: b.y, w: b.w, h: b.h });
    const box = this.mapHost().getBoundingClientRect();
    // Clear of the back button above and the toolbox below.
    const usable = { w: box.width * 0.92, h: (box.height - 200) * 0.95 };
    const fit = (usable.w / (area.w * PLAN)) * 1;
    let zoom = Math.min(readingZoom, fit);
    // Centred between the back button and the toolbox.
    const shift = (box.height / 2 - (70 + usable.h / 2)) / PLAN;
    let y = area.y + area.h / 2;
    if (b.kind === "theater" || b.kind === "spielhaus") {
      // The stage and plates fit as a whole.
      zoom = Math.min(2, fit, usable.h / (area.h * PLAN));
    } else if (area.h * PLAN * zoom > usable.h) {
      // A long text starts at its top; the rest is a pan away.
      y = area.y + (usable.h / 2 - 24) / (PLAN * zoom);
    }
    y += shift / zoom;
    this.reading = {
      b,
      back: this.reading?.back ?? { ...r.camera },
      zoom,
    };
    r.flyTo({ x: area.x + area.w / 2, y, zoom, plan: 1 });
    this.backBar.hidden = false;
    this.o.moved();
    const what =
      b.kind === "theater"
        ? "Die Bühne. Tipp die Schilder an oder spiel mit den Tasten aus der Steuerung."
        : `${this.label(b.kind, b.game)}.`;
    this.announce(`${what} Escape oder «Zurück zur Karte» kehrt zurück.`);
  }

  /**
   * Turns the view back to the map: to where it was, or, after zooming out
   * of the text, around the text at the zoom the map had.
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
        ? { x: r.camera.x, y: r.camera.y, zoom: back.zoom, plan: 0 }
        : { ...back, plan: 0 },
    );
    this.o.moved();
    this.mapHost().focus({ preventScroll: true });
  }

  /** Opens a building from outside the map, e.g. after a click on its plate. */
  focus(b: Building) {
    if (this.reading?.b.id === b.id) return;
    this.read(b);
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

  // --- The Waldmensch's hints ------------------------------------------------------------

  updateHint() {
    const current = this.o.game.currentHint();
    const show = current < hints.length && current >= this.o.game.state.hint;
    if (show) {
      const text = hints[current];
      const p = need(this.hint, "[data-hint-text]");
      if (p.textContent !== text || this.hint.hidden) {
        p.textContent = text;
        this.announce(`Der Waldmensch sagt: ${text}`);
      }
    }
    this.hint.hidden = !show;
  }
}
