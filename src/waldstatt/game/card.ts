/**
 * The card over a building (ui.ts): its name, state and condition, its
 * stock, − and + for a producing building's crew, its repair, and for a
 * ruin its clearing away. It keeps itself current while it is open, and
 * its keys go through the key dispatcher (dispatch.ts) in the context
 * `card`. Nodes are created with the DOM API.
 */
import {
  balance,
  crewKinds,
  goodMax,
  goodName,
  kinds,
  recipes,
  type Cost,
  type Good,
  type Kind,
} from "./config";
import type { Dispatcher } from "./dispatch";
import { el } from "./dom";
import type { WorldLayer } from "./overlay";
import type { Game } from "./sim";
import type { Building } from "./state";
import { most, points, share, wearLevel, wearNames } from "./wear";

/** What the card needs from the interface. */
export interface CardHost {
  game: Game;
  world: WorldLayer;
  dispatcher: Dispatcher;
  announce(text: string): void;
  label(kind: Kind, game?: string): string;
  costText(c: Cost): string;
  repair(b: Building): string | undefined;
  focusMap(): void;
}

export class BuildingCard {
  /** The card open, and the parts of it that change. */
  current: {
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

  constructor(private host: CardHost) {}

  /**
   * Opens a card over a building: its name, state and condition, its stock,
   * for a producing building − and + for its crew, its repair, and for a
   * ruin its clearing away.
   */
  open(b: Building) {
    const g = this.host.game;
    const name = this.host.label(b.kind, b.game);
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
    close.addEventListener("click", () => this.close(true));
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
      if (this.host.dispatcher.keydown(event, "card")) event.preventDefault();
    });
    card.addEventListener("keyup", (event) =>
      this.host.dispatcher.keyup(event),
    );
    const repair = el("button", {
      type: "button",
      className: "wg-button wg-primary",
    });
    repair.addEventListener("click", () => {
      this.host.repair(b);
      this.update();
    });
    const clear = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Wegräumen",
    );
    clear.addEventListener("click", () => {
      if (g.demolish(b) === "clearing")
        this.host.announce(`Die Waldleute räumen die Ruine ${name} weg.`);
      this.update();
    });
    const entry: NonNullable<BuildingCard["current"]> = {
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
    this.current = entry;
    this.host.world.showCard(b, card);
    this.update();
    this.host.announce(
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

  close(focusMap = false) {
    if (!this.current) return;
    this.current = null;
    this.host.world.closeCard();
    if (focusMap) this.host.focusMap();
  }

  /** Repairs the building of the open card (`card:repair`); why not, if not. */
  repair(): string | undefined {
    const card = this.current;
    if (!card) return "Keine Karte offen.";
    const why = this.host.repair(card.b);
    this.update();
    return why;
  }

  /** Puts one Waldmensch more or fewer into the building of the open card. */
  stepCrew(by: number) {
    const b = this.current?.b;
    if (!b || !this.current?.crew) return;
    this.host.game.setCrew(b, (b.crew ?? 0) + by);
    this.update();
    this.host.announce(this.crewText(b));
  }

  /** How many Waldleute work in a building, of how many it asks for. */
  crewText(b: Building): string {
    const there = this.host.game.crewOf(b);
    const want = b.crew ?? 0;
    return `${there} von ${want} Waldleuten`;
  }

  /** Keeps the card's state, crew and stock current, without moving focus. */
  update() {
    const card = this.current;
    if (!card) return;
    const g = this.host.game;
    const b = card.b;
    if (!g.state.buildings.includes(b)) return this.close();
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
    const cost = this.host.costText(g.repairCost(b));
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

  stateText(b: Building): string {
    const g = this.host.game;
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

  portText(b: Building): string {
    const { ports, ships } = this.host.game.harbour(b);
    if (!ships) return "noch liegt kein Schiff hier.";
    if (ports < 2) return "kein zweiter Hafen am See.";
    return ships === 1
      ? "ein Schiff fährt über diesen See."
      : `${ships} Schiffe fahren über diesen See.`;
  }
}
