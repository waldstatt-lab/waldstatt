/**
 * The game's queries for scripts (ADR 0007): a second, read-only registry
 * beside the commands. They show only what the interface shows (stock,
 * Waldleute and beds, motivation, the keyboard cursor and the tool, the
 * buildings with their state and condition), never what is hidden, such as
 * where unfound scrolls lie. Buildings reach scripts as their ids and are
 * read anew at each access; one that is gone reads as none. Also what it
 * means for a command's work to be done.
 */
import { goodKeys, kinds, type Kind } from "../config";
import { slug } from "../commands";
import type { Game } from "../sim";
import type { Building } from "../state";
import { most, points } from "../wear";
import { isKnown, isNaturalLake, isRiver } from "../world";
import type { Library } from "./check";
import type { Value } from "./compile";
import type { MachineHost, Work } from "./machine";

/** What the queries need from the interface beyond the game. */
export interface QueryUi {
  /** The keyboard cursor's tile, or the middle of the view. */
  cursor(): { x: number; y: number };
  /** The tool chosen: holzhacken, pflastern, reparieren, abreissen, or none. */
  tool(): string | null;
  /** A building's name, with its game's title. */
  name(b: Building): string;
}

/** The game's queries, with how many values each takes and what it gives. */
export const gameQueries: Library["queries"] = {
  stock: {
    args: [0, 0],
    describe: "Die Vorräte: stock.wood, stock.stones, stock.bread …",
  },
  people: { args: [0, 0], describe: "Wie viele Waldleute leben" },
  beds: { args: [0, 0], describe: "Wie viele Betten es gibt" },
  mood: { args: [0, 0], describe: "Die Stimmung in Prozent" },
  cursor: { args: [0, 0], describe: "Die Cursorstelle: cursor.x, cursor.y" },
  tool: { args: [0, 0], describe: "Das gewählte Werkzeug, oder none" },
  time: { args: [0, 0], describe: "Sekunden Spielzeit" },
  buildings: {
    args: [0, 1],
    describe: 'Die Gebäude, oder die einer Art: buildings("hütte")',
  },
  "building-at": {
    args: [2, 2],
    describe: "Das Gebäude an einer Stelle, oder none",
  },
  "field-at": {
    args: [2, 2],
    describe:
      'Was auf einem Feld ist: "building", "lake", "river", "tree", "seedling", "grass", oder "unknown", solange es nicht geladen ist',
  },
  "marked-at": {
    args: [2, 2],
    describe: "Ob ein Baum an einer Stelle zum Fällen markiert ist",
  },
  count: { args: [1, 1], describe: "Wie viele Einträge eine Liste hat" },
  min: { args: [2, 2], describe: "Die kleinere von zwei Zahlen" },
  max: { args: [2, 2], describe: "Die grössere von zwei Zahlen" },
  abs: { args: [1, 1], describe: "Der Betrag einer Zahl" },
  floor: { args: [1, 1], describe: "Abgerundet" },
  round: { args: [1, 1], describe: "Gerundet" },
};

/** The fields of a building, as scripts read them. */
export const buildingFields: Record<string, string> = {
  id: "Seine Nummer",
  kind: "Seine Art, wie huette",
  name: "Sein Name",
  x: "Links oben, in Feldern",
  y: "Links oben, in Feldern",
  w: "Breite in Feldern",
  h: "Tiefe in Feldern",
  state: "site, done, ruin oder drowned",
  condition: "Sein Zustand in Punkten",
  most: "Sein höchster Zustand",
  crew: "Waldleute darin",
  repairing: "Ob es repariert wird",
  clearing: "Ob seine Ruine weggeräumt wird",
};

/** A kind of building by its id or its German name, such as «hütte». */
/** What a field holds, as the map shows it (`field-at`). */
export interface FieldFacts {
  /** Whether its page of the map has loaded. */
  known: boolean;
  building: boolean;
  /** A lake, natural or the Sihlsee, or the flood wave. */
  lake: boolean;
  river: boolean;
  /** A tree, also one over a hidden text. */
  tree: boolean;
  seedling: boolean;
}

/**
 * What `field-at` says of a field, the first that holds. A hidden text
 * lies under forest and reads as a tree, so nothing hidden shows.
 */
export function fieldKind(f: FieldFacts): string {
  if (!f.known) return "unknown";
  if (f.building) return "building";
  if (f.lake) return "lake";
  if (f.river) return "river";
  if (f.tree) return "tree";
  if (f.seedling) return "seedling";
  return "grass";
}

function kindOf(name: string): Kind | undefined {
  if (Object.hasOwn(kinds, name)) return name as Kind;
  const s = slug(name);
  return (Object.keys(kinds) as Kind[]).find((k) => slug(kinds[k].name) === s);
}

/** The queries, the fields, the work and how values read, for the machine. */
export function gameHost(
  game: Game,
  ui: QueryUi,
): Pick<MachineHost, "now" | "query" | "field" | "describe" | "done"> {
  const find = (id: number) => game.state.buildings.find((b) => b.id === id);
  const num = (v: Value, what: string) =>
    typeof v === "number" ? v : { error: `${what} braucht eine Zahl.` };
  return {
    now: () => game.state.clock,
    query(name, args) {
      const s = game.state;
      switch (name) {
        case "stock":
          return {
            r: Object.fromEntries(goodKeys.map((k) => [k, s.stock[k]])),
          };
        case "people":
          return game.workers.length;
        case "beds":
          return game.people.beds();
        case "mood":
          return Math.round(s.mood);
        case "cursor": {
          const c = ui.cursor();
          return { r: { x: c.x, y: c.y } };
        }
        case "tool":
          return ui.tool();
        case "time":
          return Math.floor(s.clock);
        case "buildings": {
          let list = s.buildings;
          if (args.length) {
            if (typeof args[0] !== "string")
              return {
                error: '«buildings» braucht eine Art als Text, wie "hütte".',
              };
            const kind = kindOf(args[0]);
            if (!kind) return { error: `Die Art «${args[0]}» gibt es nicht.` };
            list = list.filter((b) => b.kind === kind);
          }
          return list.slice(0, 1000).map((b) => ({ b: b.id }));
        }
        case "building-at": {
          const [x, y] = args;
          if (typeof x !== "number" || typeof y !== "number")
            return { error: "«building-at» braucht zwei Zahlen." };
          const b = game.buildingAt(Math.floor(x), Math.floor(y));
          return b ? { b: b.id } : null;
        }
        case "field-at": {
          const [x, y] = args;
          if (typeof x !== "number" || typeof y !== "number")
            return { error: "«field-at» braucht zwei Zahlen." };
          const tx = Math.floor(x);
          const ty = Math.floor(y);
          // A natural lake is water too; what is water but no lake is a river.
          const lake =
            isNaturalLake(tx, ty) ||
            game.isLake(tx, ty) ||
            (!isRiver(tx, ty) && game.isWater(tx, ty));
          return fieldKind({
            known: isKnown(tx, ty),
            building: !!game.buildingAt(tx, ty),
            lake,
            river: isRiver(tx, ty),
            tree: game.isTree(tx, ty),
            seedling: game.seedling(tx, ty) > 0,
          });
        }
        case "marked-at": {
          const [x, y] = args;
          if (typeof x !== "number" || typeof y !== "number")
            return { error: "«marked-at» braucht zwei Zahlen." };
          const tx = Math.floor(x);
          const ty = Math.floor(y);
          // The marks show on the map, so a script may see them.
          return game.isTree(tx, ty) && game.isMarked(tx, ty);
        }
        case "count": {
          const v = args[0];
          return Array.isArray(v)
            ? v.length
            : typeof v === "string"
              ? v.length
              : { error: "«count» braucht eine Liste." };
        }
        case "min":
        case "max": {
          const a = num(args[0], `«${name}»`);
          const b = num(args[1], `«${name}»`);
          if (typeof a !== "number") return a;
          if (typeof b !== "number") return b;
          return name === "min" ? Math.min(a, b) : Math.max(a, b);
        }
        case "abs":
        case "floor":
        case "round": {
          const a = num(args[0], `«${name}»`);
          if (typeof a !== "number") return a;
          return Math[name](a);
        }
        default:
          return { error: `Die Abfrage «${name}» gibt es nicht.` };
      }
    },
    field(id, name) {
      const b = find(id);
      if (!b) return null;
      switch (name) {
        case "id":
          return b.id;
        case "kind":
          return b.kind;
        case "name":
          return ui.name(b);
        case "x":
          return b.x;
        case "y":
          return b.y;
        case "w":
          return b.w;
        case "h":
          return b.h;
        case "state":
          return b.state;
        case "condition":
          return b.state === "done" ? points(b) : 0;
        case "most":
          return most(b);
        case "crew":
          return game.crewOf(b);
        case "repairing":
          return !!b.repair;
        case "clearing":
          return !!b.clearing;
        default:
          return {
            error: `Ein Gebäude hat kein Feld «${name}»; es hat ${Object.keys(buildingFields).join(", ")}.`,
          };
      }
    },
    describe(id) {
      const b = find(id);
      return b
        ? `${ui.name(b)} (${b.x}, ${b.y})`
        : "ein Gebäude, das es nicht mehr gibt";
    },
    done(w: Work) {
      for (const id of w.ids) {
        const b = find(id);
        if (w.kind === "cleared") {
          if (b) return false;
          continue;
        }
        if (!b)
          return "Ein Gebäude, auf das gewartet wird, gibt es nicht mehr.";
        if (b.state === "ruin" || b.state === "drowned")
          return `${ui.name(b)} ist ${b.state === "ruin" ? "eine Ruine" : "überflutet"}, bevor es fertig war.`;
        if (w.kind === "built" && b.state !== "done") return false;
        if (w.kind === "repaired" && b.repair) return false;
      }
      return true;
    },
  };
}
