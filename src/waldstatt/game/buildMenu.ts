/**
 * The build menu (ui.ts): built once as a grid of pictures, painted by the
 * same code as the map, and names per group; it shows what has appeared and
 * marks what cannot be built now. A button starts placing the building.
 * Nodes are created with the DOM API.
 */
import { buildingPicture } from "./art";
import { groups, kinds, type Kind } from "./config";
import { el, need } from "./dom";
import type { Game } from "./sim";
import type { GameInfo } from "./texts";

type PlaceMode = "mouse" | "keys" | "touch";

/** What the build menu needs from the interface. */
export interface BuildMenuHost {
  game: Game;
  games: GameInfo[];
  /** The build menu's element. */
  menu: HTMLElement;
  announce(text: string): void;
  label(kind: Kind, game?: string): string;
  gameTitle(id?: string): string;
  closeMenus(): void;
  /** The kind of pointer last pressed: "mouse", "touch" or "pen". */
  pointerKind(): string;
  startPlacing(kind: Kind, game: string | undefined, mode: PlaceMode): void;
}

export class BuildMenu {
  items: {
    kind: Kind;
    game?: string;
    button: HTMLButtonElement;
    item: HTMLElement;
    picture: HTMLCanvasElement;
    drawn: boolean;
  }[] = [];
  private groups: { element: HTMLElement; kinds: Kind[] }[] = [];

  constructor(private host: BuildMenuHost) {
    this.render();
  }

  /**
   * Builds the menu once, as a grid of pictures and names per group;
   * updateBuildMenu() shows what is available and keeps it current in place.
   */
  render() {
    const list = need(this.host.menu, "[data-build-list]");
    list.replaceChildren();
    this.items = [];
    this.groups = [];
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
          info.limit === "game"
            ? this.host.games.map((g) => g.id)
            : [undefined];
        for (const game of games) {
          const picture = el("canvas", { width: 144, height: 112 });
          picture.setAttribute("aria-hidden", "true");
          const button = el(
            "button",
            { type: "button", className: "wg-build-item" },
            picture,
            el(
              "span",
              { className: "wg-build-name" },
              this.host.label(kind, game),
            ),
          );
          button.dataset.build = `${kind}:${game ?? ""}`;
          button.addEventListener("click", (event) => {
            const why = this.host.game.unavailable(kind, game);
            if (why)
              return this.host.announce(
                `${this.host.label(kind, game)}: ${why}`,
              );
            this.host.closeMenus();
            // The keyboard's click has no detail; a pointer's says which.
            const mode: PlaceMode =
              event.detail === 0
                ? "keys"
                : this.host.pointerKind() === "mouse"
                  ? "mouse"
                  : "touch";
            this.host.startPlacing(kind, game, mode);
          });
          const item = el("li", {}, button);
          items.append(item);
          this.items.push({
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
      this.groups.push({ element, kinds: kindsHere });
    }
    this.update();
  }

  /** Paints a building's picture small for its place in the menu. */
  private drawPicture(entry: (typeof this.items)[number]) {
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
      this.host.gameTitle(entry.game),
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
  update() {
    const g = this.host.game;
    const shown = new Set<Kind>();
    for (const entry of this.items) {
      const visible = g.shown(entry.kind, entry.game);
      entry.item.hidden = !visible;
      if (!visible) continue;
      shown.add(entry.kind);
      this.drawPicture(entry);
      if (g.unavailable(entry.kind, entry.game))
        entry.button.setAttribute("aria-disabled", "true");
      else entry.button.removeAttribute("aria-disabled");
    }
    for (const group of this.groups)
      group.element.hidden = !group.kinds.some((k) => shown.has(k));
  }
}
