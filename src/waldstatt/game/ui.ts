/**
 * The HTML interface over the map: the toolbox with supplies and tools
 * (axe, saw, tearing down), the build menu, placing buildings, the building
 * info, confirmations, the Waldmensch's hints and the announcements for
 * screen readers. Texts are read on the map itself (overlay.ts). Text comes
 * from the page, the balance table or fixed strings; nodes are created with
 * the DOM API, never from HTML strings.
 */
import { balance, groups, kinds, type Kind } from "./config";
import type { MapHandlers, Tile } from "./input";
import type { WorldLayer } from "./overlay";
import type { Renderer } from "./render";
import { hints, type Game } from "./sim";
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
  reset(): void;
  moved(): void;
}

export class Ui {
  private tool: Tool = "none";
  private placing: { kind: Kind; game?: string; at?: Tile } | null = null;
  private sawFrom: Tile | null = null;
  private selected: Building | null = null;
  private suppliesDirty = true;
  private infoClock = 0;

  private toolbox: HTMLElement;
  private buildMenu: HTMLElement;
  private mainMenu: HTMLElement;
  private info: HTMLElement;
  private placingBar: HTMLElement;
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
    this.info = need(root, "[data-info]");
    this.placingBar = need(root, "[data-placing]");
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
    need(this.info, "[data-info-close]").addEventListener("click", () =>
      this.select(null),
    );
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

    document.addEventListener("keydown", (event) => {
      // The map handles its own Escape (input.ts).
      if (event.key !== "Escape" || event.target === this.mapHost()) return;
      if (this.confirmDialog.open) return;
      if (!this.buildMenu.hidden || !this.mainMenu.hidden) {
        this.closeMenus(true);
        event.preventDefault();
      } else if (this.placing) {
        this.stopPlacing();
      } else if (this.selected) {
        this.select(null);
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

  frame(dt: number) {
    if (this.suppliesDirty) {
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
    this.infoClock += dt;
    if (this.selected && this.infoClock > 0.4) {
      this.infoClock = 0;
      this.fillInfo(this.selected, true);
    }
  }

  // --- Tools and menus ------------------------------------------------------

  setTool(tool: Tool) {
    if (this.placing) this.stopPlacing();
    this.tool = this.tool === tool ? "none" : tool;
    this.sawFrom = null;
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
        "Abreissen: ein Gebäude antippen. Die Hälfte des Holzes kommt zurück.",
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
    this.select(null);
    this.placing = { kind, game };
    this.mapHost().dataset.mode = "place";
    const name = this.label(kind, game);
    need(this.placingBar, "[data-placing-text]").textContent =
      kind === "damm"
        ? `${name}: nur dort, wo die Sihl das Tal verlässt. Blau wird der Sihlsee.`
        : `${name} platzieren: auf freien Boden tippen oder klicken.`;
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
      `${name}: mit Pfeiltasten verschieben, Eingabetaste baut, Escape bricht ab.`,
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

  private async tryPlace(tile: Tile) {
    if (!this.placing) return;
    const { kind, game } = this.placing;
    const at = this.anchor(tile);
    const spot = this.o.game.placement(kind, game, at.x, at.y);
    if (!spot.ok) return this.announce(spot.reason ?? "Hier nicht.");
    if (kind === "damm") {
      const drowned = this.o.game.wouldDrown();
      const yes = await this.confirm({
        title: "Damm bauen?",
        text:
          drowned.length === 0
            ? "Wenn der Damm steht, staut die Sihl zum Sihlsee. Im Becken steht noch nichts."
            : `Wenn der Damm steht, staut die Sihl zum Sihlsee. ${drowned.length === 1 ? "Ein Gebäude geht" : `${drowned.length} Gebäude gehen`} unter:`,
        list: drowned.map((b) => this.label(b.kind, b.game)),
        yes: "Damm bauen",
      });
      if (!yes || !this.placing) return;
    }
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

  handlers(): MapHandlers {
    return {
      sawing: () => this.tool === "saw" && !this.placing,
      tap: (tile, pointer) => {
        if (this.placing) {
          if (pointer === "mouse") void this.tryPlace(tile);
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
        if (this.placing) return void this.tryPlace(tile);
        if (this.tool === "saw") {
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
        else if (this.selected) this.select(null);
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
    if (this.tool === "demolish") {
      if (b) this.askDemolish(b);
      else this.announce("Tippe auf ein Gebäude, das weg soll.");
      return;
    }
    if (b) return this.select(b);
    if (this.tool === "axe") {
      const result = g.toggleMark(tile.x, tile.y);
      if (result === "marked") this.announce("Baum markiert.");
      else if (result === "unmarked") this.announce("Markierung entfernt.");
      return;
    }
    if (this.selected) this.select(null);
    else if (this.tool === "none" && g.isTree(tile.x, tile.y))
      this.announce("Nimm die Axt oder die Säge, um Bäume zu markieren.");
  }

  // --- Building info --------------------------------------------------------------

  select(b: Building | null) {
    this.selected = b;
    this.o.renderer.setSelected(b);
    this.info.hidden = !b;
    if (b) this.fillInfo(b, false);
  }

  /** Called when a building changes; keeps the open info current. */
  building(b: Building, removed: boolean) {
    if (this.selected?.id === b.id) {
      if (removed) this.select(null);
      else this.fillInfo(b, true);
    }
    if (!this.buildMenu.hidden) this.updateBuildMenu();
  }

  private stateText(b: Building): string {
    const info = kinds[b.kind];
    if (b.state === "drowned")
      return "Überflutet. Liegt auf dem Grund des Sihlsees.";
    if (b.state === "site") {
      const percent = Math.round(this.o.game.progress(b) * 100);
      return percent === 0
        ? "Baustelle. Die Waldleute kommen."
        : `Im Bau: ${percent} %.`;
    }
    if (info.text)
      return "Der Text steht im Wald über dem Gebäude. Zoom näher, um ihn zu lesen.";
    const texts: Partial<Record<Kind, string>> = {
      huette: "Hier wohnt ein Waldmensch.",
      schafweide: `Die Schafe geben Pergament (höchstens ${balance.maxParchment}).`,
      druckerei: `Druckt aus Pergament Drucke (höchstens ${balance.maxPrints}).`,
      kloster: "Das Kloster Einsiedeln, vereinfacht. Der Stolz der Waldstatt.",
      damm: "Der Damm staut die Sihl zum Sihlsee.",
      theater: "Auf der Bühne spielst du die Spiele an, deren Spielhaus steht.",
      spielhaus: this.o.games.find((g) => g.id === b.game)?.tagline ?? "",
    };
    return texts[b.kind] ?? info.about;
  }

  private fillInfo(b: Building, refresh: boolean) {
    const title = need(this.info, "[data-info-title]");
    const state = need(this.info, "[data-info-state]");
    const actions = need(this.info, "[data-info-actions]");
    title.textContent = this.label(b.kind, b.game);
    state.textContent = this.stateText(b);
    const signature = `${b.id}:${b.state}`;
    if (refresh && actions.dataset.signature === signature) return;
    actions.dataset.signature = signature;
    actions.replaceChildren();
    const info = kinds[b.kind];
    if (b.state === "done") {
      if (b.kind === "spielhaus") {
        const game = this.o.games.find((g) => g.id === b.game);
        if (game) {
          actions.append(
            el(
              "a",
              { className: "wg-button wg-primary", href: game.playUrl },
              `${game.title} spielen`,
            ),
            el(
              "a",
              { className: "wg-button", href: game.sourceUrl },
              "Quellcode",
            ),
          );
        }
      }
      if (info.text || b.kind === "theater") {
        const button = el(
          "button",
          { type: "button", className: "wg-button wg-primary" },
          b.kind === "theater" ? "Zur Bühne" : "Lesen",
        );
        button.addEventListener("click", () => this.focusOn(b));
        actions.append(button);
      }
    }
  }

  /** Brings a building's text or stage into view, close enough to read. */
  private focusOn(b: Building) {
    const r = this.o.renderer;
    r.camera.zoom = r.clampZoom(Math.max(r.camera.zoom, 1.3));
    r.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    // A standing text or the stage rises above the building: show its middle.
    r.pan(0, this.o.world.focusOffset(b.id) * r.camera.zoom);
    this.o.moved();
    this.select(null);
  }

  private askDemolish(b: Building) {
    if (!this.o.game.canDemolish(b))
      return this.announce(
        b.state === "drowned"
          ? "Das liegt unter Wasser."
          : "Der Damm bleibt stehen.",
      );
    const refund = Math.floor(kinds[b.kind].cost.wood * balance.refund);
    void this.confirm({
      title: `${this.label(b.kind, b.game)} abreissen?`,
      text: `Du bekommst ${refund} Holz zurück.`,
      yes: "Abreissen",
    }).then((yes) => {
      if (!yes) return;
      this.o.game.demolish(b);
      this.announce(`${this.label(b.kind, b.game)} abgerissen.`);
    });
  }

  // --- Confirmations ------------------------------------------------------------------

  private confirm(o: {
    title: string;
    text: string;
    list?: string[];
    yes: string;
  }): Promise<boolean> {
    const d = this.confirmDialog;
    need(d, "[data-confirm-title]").textContent = o.title;
    need(d, "[data-confirm-text]").textContent = o.text;
    const list = need(d, "[data-confirm-list]");
    list.replaceChildren(...(o.list ?? []).map((item) => el("li", {}, item)));
    list.hidden = !o.list?.length;
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
