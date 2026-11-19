/**
 * The keymap (ADR 0005, ADR 0006): keys and sequences of keys bound to
 * commands (commands.ts), in contexts, in the shape of the Zed editor's
 * keymap: a list of sections, each with a context and its bindings from keys
 * to a command or chain. The visitor's own sections are layered over the
 * defaults; `null` takes a key away. A context is one of `map`, `placing`,
 * `reading`, `text` and `card`, or an expression of them with `&&`, `||`,
 * `!` and parentheses. Of the bindings that apply, the one of the innermost
 * context wins (`text` and `card` before `placing` and `reading` before
 * `map`), then the visitor's before the default, then the later. Keys are
 * named readably: `left`, `enter`, `space`, `shift-up`, and characters as
 * typed (`g`, `G`, `+`); a sequence is keys joined by spaces (`g g`).
 * Escape, Tab, the digits (counts) and keys with Ctrl, Alt or Cmd cannot be
 * bound. The visitor's sections and named macros are kept in the IndexedDB
 * database `waldstatt-games-settings`, apart from the forest, so «Neu
 * beginnen» keeps them; a keymap of version 1 is converted once. What is
 * read back, typed or loaded from a file is untrusted and checked. The same
 * database keeps what the visitor unlocked, such as the scripts (ADR 0007),
 * in a record of its own, so a keymap file neither carries nor drops it.
 */
import { contexts, type Context } from "./commands";

/** A section of the keymap, as in its JSON. */
export interface Section {
  context: string;
  bindings: Record<string, string | null>;
}

/** The visitor's keymap, macros and scripts, as in its JSON. */
export interface UserKeymap {
  bindings: Section[];
  macros: Record<string, string>;
  /** Scripts' sources by name (ADR 0007); their runs belong to the forest. */
  scripts?: Record<string, string>;
  /** The script editor's settings: vim's keys on or off. */
  editor?: { vim?: boolean };
}

/** One binding, as it is looked up. */
export interface Binding {
  keys: string[];
  command: string | null;
  context: string;
  test: (active: Set<Context>) => boolean;
  /** How inner its context is: the later wins among equals. */
  depth: number;
  user: boolean;
  order: number;
}

/** The context in which each kind of binding applies by default. */
export const defaults: Section[] = [
  {
    context: "map && !text",
    bindings: {
      left: "left",
      h: "left",
      s: "left",
      right: "right",
      l: "right",
      e: "right",
      up: "up",
      k: "up",
      u: "up",
      down: "down",
      j: "down",
      i: "down",
      v: "selection:start",
      o: "selection:other",
      enter: "enter",
      space: "enter",
    },
  },
  {
    context: "map",
    bindings: {
      "+": "zoom:in",
      "=": "zoom:in",
      "-": "zoom:out",
      _: "zoom:out",
      a: "tool:holzhacken",
      p: "tool:pflastern",
      r: "tool:reparieren",
      x: "tool:abreissen",
      b: "menu:build",
      m: "menu:main",
      "/": "find:texts",
      ":": "find:commands",
      q: "macro:record",
      "@": "macro:replay",
    },
  },
  {
    context: "text",
    bindings: {
      left: "text:left",
      h: "text:left",
      right: "text:right",
      l: "text:right",
      up: "text:up",
      k: "text:up",
      down: "text:down",
      j: "text:down",
      w: "text:word-next",
      b: "text:word-back",
      e: "text:word-end",
      "g g": "text:start",
      G: "text:end",
      v: "text:select",
      V: "text:select-line",
      o: "text:other",
      y: "text:copy",
    },
  },
  {
    context: "card",
    bindings: {
      r: "card:repair",
      "+": "crew:more",
      up: "crew:more",
      "-": "crew:less",
      down: "crew:less",
    },
  },
];

const depths: Record<Context, number> = {
  map: 1,
  placing: 2,
  reading: 2,
  text: 3,
  card: 3,
};

const limits = {
  /** Bindings in the visitor's keymap, and keys in one sequence. */
  bindings: 500,
  sequence: 4,
  /** Characters of a command or chain, of a key name, of a macro's name. */
  command: 4000,
  key: 24,
  name: 60,
  macros: 200,
  scripts: 100,
  source: 50_000,
  /** Characters of the keymap's JSON. */
  json: 500_000,
};

// --- Key names ---------------------------------------------------------------------

const named: Record<string, string> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  " ": "space",
  Enter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};
const names = new Set([
  ...Object.values(named),
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

/** Keys that only announce a modifier or a composition, never bound. */
const silent = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "Dead",
  "Process",
  "Compose",
  "Unidentified",
]);

/** Whether a key press is only a modifier, to wait for the real key. */
export const isModifier = (key: string) => silent.has(key);

/**
 * A pressed key's name, such as `left`, `shift-up`, `g` or `G`, or null for
 * a modifier or a key without a name. Escape, Tab and digits have names but
 * are never bound.
 */
export function keyName(event: KeyboardEvent): string | null {
  const key = event.key;
  if (silent.has(key)) return null;
  if (key === "Escape") return "escape";
  if (key === "Tab") return "tab";
  const name =
    named[key] ??
    (/^F([1-9]|1[0-2])$/.test(key) ? key.toLowerCase() : undefined);
  if (name) return event.shiftKey ? `shift-${name}` : name;
  return [...key].length === 1 ? key : null;
}

/** The same key without Shift: `shift-up` → `up`, `G` → `g`; or null. */
export function unshifted(name: string): string | null {
  if (name.startsWith("shift-")) return name.slice(6);
  const lower = name.toLowerCase();
  return lower !== name ? lower : null;
}

/** Why a key cannot be bound, or undefined if it can. */
export function reserved(name: string): string | undefined {
  if (name === "escape") return "Escape bricht immer ab.";
  if (name === "tab") return "Tab wechselt immer zum nächsten Bedienelement.";
  if (/^[0-9]$/.test(name))
    return "Ziffern sind für Zahlen vor einer Taste, wie «10» und dann «→».";
  if (name.length > limits.key || /[\p{Cc}\p{Cf}\s]/u.test(name))
    return "Diese Taste geht nicht.";
  const base = name.startsWith("shift-") ? name.slice(6) : name;
  if (name.startsWith("shift-") && !names.has(base))
    return `«${name}»: Umschalt nur mit benannten Tasten; Buchstaben gross schreiben.`;
  if ([...name].length !== 1 && !names.has(base))
    return `«${name}» ist keine Taste.`;
  return undefined;
}

/** Reads a sequence such as `g g`, or why not. */
export function readKeys(text: string): string[] | string {
  const keys = text.trim().split(/\s+/).filter(Boolean);
  if (!keys.length) return "Keine Taste.";
  if (keys.length > limits.sequence)
    return `Mehr als ${limits.sequence} Tasten nacheinander gehen nicht.`;
  for (const key of keys) {
    const why = reserved(key);
    if (why) return why;
  }
  return keys;
}

const labels: Record<string, string> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  space: "Leertaste",
  enter: "Eingabetaste",
  backspace: "Rücktaste",
  delete: "Entf",
  insert: "Einfg",
  home: "Pos1",
  end: "Ende",
  pageup: "Bild↑",
  pagedown: "Bild↓",
};

const spoken: Record<string, string> = {
  left: "Pfeil links",
  right: "Pfeil rechts",
  up: "Pfeil hoch",
  down: "Pfeil runter",
  "/": "Schrägstrich",
  ":": "Doppelpunkt",
  "+": "Plus",
  "-": "Minus",
  "=": "Gleich",
  _: "Unterstrich",
  "@": "At-Zeichen",
};

/** A key or sequence as it is shown, such as «←», «Umschalt+↑» or «g g». */
export function keyLabel(keys: string | string[]): string {
  const one = (k: string) =>
    k.startsWith("shift-")
      ? `Umschalt+${labels[k.slice(6)] ?? k.slice(6)}`
      : (labels[k] ?? k);
  return (typeof keys === "string" ? keys.split(" ") : keys).map(one).join(" ");
}

/** A key or sequence as a screen reader says it. */
export function keySpoken(keys: string | string[]): string {
  const one = (k: string) => {
    if (k.startsWith("shift-")) return `Umschalt ${keySpoken(k.slice(6))}`;
    if (spoken[k]) return spoken[k];
    if (k.length === 1 && k !== k.toLowerCase())
      return `Umschalt ${k.toLowerCase()}`;
    return keyLabel(k);
  };
  return (typeof keys === "string" ? keys.split(" ") : keys)
    .map(one)
    .join(", dann ");
}

// --- Contexts ----------------------------------------------------------------------

type Node =
  | { op: "id"; id: Context }
  | { op: "not"; a: Node }
  | { op: "and" | "or"; a: Node; b: Node };

/** Reads a context expression, or why it is not one. */
export function readContext(
  text: string,
): { test: (active: Set<Context>) => boolean; depth: number } | string {
  const tokens = text.match(/&&|\|\||[!()]|[a-z]+|\S/g) ?? [];
  if (!tokens.length) return "Kein Kontext.";
  if (tokens.length > 60) return "Der Kontext ist zu lang.";
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const primary = (): Node => {
    const t = tokens[i++];
    if (t === "!") return { op: "not", a: primary() };
    if (t === "(") {
      const node = or();
      if (tokens[i++] !== ")") fail("Eine Klammer fehlt.");
      return node;
    }
    if (t && (contexts as string[]).includes(t))
      return { op: "id", id: t as Context };
    return fail(
      t
        ? `«${t}» ist kein Kontext. Es gibt ${contexts.join(", ")}.`
        : "Der Kontext endet zu früh.",
    );
  };
  const and = (): Node => {
    let node = primary();
    while (tokens[i] === "&&") {
      i++;
      node = { op: "and", a: node, b: primary() };
    }
    return node;
  };
  const or = (): Node => {
    let node = and();
    while (tokens[i] === "||") {
      i++;
      node = { op: "or", a: node, b: and() };
    }
    return node;
  };
  let tree: Node;
  try {
    tree = or();
    if (i < tokens.length) fail(`«${tokens[i]}» passt hier nicht.`);
  } catch (error) {
    return (error as Error).message;
  }
  const evaluate = (n: Node, active: Set<Context>): boolean =>
    n.op === "id"
      ? active.has(n.id)
      : n.op === "not"
        ? !evaluate(n.a, active)
        : n.op === "and"
          ? evaluate(n.a, active) && evaluate(n.b, active)
          : evaluate(n.a, active) || evaluate(n.b, active);
  // How inner: the deepest context named without «!».
  const depth = (n: Node, negated = false): number =>
    n.op === "id"
      ? negated
        ? 0
        : depths[n.id]
      : n.op === "not"
        ? depth(n.a, !negated)
        : Math.max(depth(n.a, negated), depth(n.b, negated));
  return { test: (active) => evaluate(tree, active), depth: depth(tree) };
}

// --- The keymap ---------------------------------------------------------------------

let user: UserKeymap = { bindings: [], macros: {} };
let all: Binding[] = [];
const listeners = new Set<() => void>();

/** Calls back after every change, such as to update the help texts. */
export function onChange(listener: () => void) {
  listeners.add(listener);
}

function build() {
  const list: Binding[] = [];
  let order = 0;
  const add = (sections: Section[], isUser: boolean) => {
    for (const section of sections) {
      const context = readContext(section.context);
      if (typeof context === "string") continue;
      for (const [keys, command] of Object.entries(section.bindings)) {
        const read = readKeys(keys);
        if (typeof read === "string") continue;
        list.push({
          keys: read,
          command,
          context: section.context,
          test: context.test,
          depth: context.depth,
          user: isUser,
          order: order++,
        });
      }
    }
  };
  add(defaults, false);
  add(user.bindings, true);
  all = list;
}
build();

const better = (a: Binding, b: Binding) =>
  a.depth !== b.depth
    ? a.depth > b.depth
    : a.user !== b.user
      ? a.user
      : a.order > b.order;

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * What a sequence of keys does in the active contexts: the winning binding's
 * command (null if a key was taken away), and whether a longer sequence
 * starting with these keys is bound.
 */
export function resolve(
  keys: string[],
  active: Set<Context>,
): { command?: string | null; longer: boolean } {
  let winner: Binding | undefined;
  let longer = false;
  for (const b of all) {
    if (!b.test(active)) continue;
    if (same(b.keys, keys)) {
      if (!winner || better(b, winner)) winner = b;
    } else if (
      b.keys.length > keys.length &&
      keys.every((k, i) => b.keys[i] === k) &&
      b.command !== null
    )
      longer = true;
  }
  return { command: winner?.command, longer };
}

/**
 * The bindings in force: for each sequence and context, the one that wins
 * there, without those taken away. For the dialog and the help texts.
 */
export function effective(): Binding[] {
  const groups = new Map<string, Binding>();
  for (const b of all) {
    const key = `${b.keys.join(" ")}\u0000${b.context}`;
    const other = groups.get(key);
    if (!other || better(b, other)) groups.set(key, b);
  }
  return [...groups.values()].filter((b) => {
    if (b.command === null) return false;
    // A default shadowed by a visitor's null in another, as inner context.
    return !all.some(
      (o) =>
        o.command === null &&
        o.user &&
        same(o.keys, b.keys) &&
        o.depth >= b.depth &&
        !b.user,
    );
  });
}

/** The keys bound to a command, as written, in force; the first first. */
export function keysFor(command: string): string[][] {
  return effective()
    .filter((b) => b.command === command)
    .map((b) => b.keys);
}

/** The visitor's own keymap and macros, as a copy. */
export function userKeymap(): UserKeymap {
  return structuredClone(user);
}

/** The visitor's named macros. */
export function macros(): Record<string, string> {
  return { ...user.macros };
}

/** The visitor's scripts' sources, by name. */
export function scripts(): Record<string, string> {
  return { ...(user.scripts ?? {}) };
}

/** Whether the script editor uses vim's keys. */
export function editorVim(): boolean {
  return user.editor?.vim === true;
}

export function setEditorVim(on: boolean) {
  const next = userKeymap();
  next.editor = { ...(next.editor ?? {}), vim: on };
  use(next, true);
}

/** Saves a script's source under a name, or deletes it with null. */
export function setScript(name: string, source: string | null) {
  const next = userKeymap();
  const all = { ...(next.scripts ?? {}) };
  if (source === null) delete all[name];
  else all[name] = source.slice(0, limits.source);
  next.scripts = all;
  use(next, true);
}

function use(next: UserKeymap, store: boolean) {
  user = next;
  build();
  for (const listener of listeners) listener();
  if (store) void write(next).catch(() => undefined);
}

/** Replaces the visitor's keymap and macros with ones already checked. */
export function setUserKeymap(next: UserKeymap) {
  use(structuredClone(next), true);
}

/**
 * Binds keys to a command in a context, in the visitor's keymap, replacing
 * what the visitor bound there before; null takes the key away.
 */
export function bind(keys: string[], context: string, command: string | null) {
  const next = userKeymap();
  const name = keys.join(" ");
  let section = next.bindings.find((s) => s.context === context);
  if (!section) {
    section = { context, bindings: {} };
    next.bindings.push(section);
  }
  section.bindings[name] = command;
  use(next, true);
}

/**
 * Removes a binding: the visitor's own is deleted; a default is taken away
 * with null.
 */
export function unbind(b: Pick<Binding, "keys" | "context" | "user">) {
  const next = userKeymap();
  const name = b.keys.join(" ");
  const section = next.bindings.find((s) => s.context === b.context);
  const isDefault = defaults.some(
    (d) => d.context === b.context && Object.hasOwn(d.bindings, name),
  );
  if (b.user && section) {
    delete section.bindings[name];
    if (isDefault) section.bindings[name] = null;
  } else if (!b.user) {
    if (section) section.bindings[name] = null;
    else next.bindings.push({ context: b.context, bindings: { [name]: null } });
  }
  next.bindings = next.bindings.filter((s) => Object.keys(s.bindings).length);
  use(next, true);
}

export function setMacro(name: string, steps: string | null) {
  const next = userKeymap();
  if (steps === null) delete next.macros[name];
  else next.macros[name] = steps;
  use(next, true);
}

/** The default bindings again; the macros, scripts and settings stay. */
export function reset() {
  use({ ...userKeymap(), bindings: [] }, true);
}

// --- Checking what is read --------------------------------------------------------

/** A problem in a keymap read back or typed, with its line if known. */
export interface Problem {
  text: string;
  line?: number;
}

/**
 * Checks a keymap: its shape, every context, key and command (with
 * `command`, which reads a chain and says why not), and the macros. Returns
 * the keymap with only what passed, and the problems found.
 */
export function check(
  raw: unknown,
  command: (text: string) => string | undefined,
  source = "",
): { keymap: UserKeymap; problems: Problem[] } {
  const problems: Problem[] = [];
  const keymap: UserKeymap = { bindings: [], macros: {} };
  const lineOf = (needle: string) => {
    if (!source) return undefined;
    const i = source.indexOf(JSON.stringify(needle));
    return i < 0 ? undefined : source.slice(0, i).split("\n").length;
  };
  const say = (text: string, near?: string) =>
    problems.push({
      text,
      line: near === undefined ? undefined : lineOf(near),
    });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    say("Erwartet wird ein Objekt mit «bindings» und «macros».");
    return { keymap, problems };
  }
  const r = raw as Record<string, unknown>;
  const sections = r.bindings ?? [];
  if (!Array.isArray(sections)) say("«bindings» muss eine Liste sein.");
  else {
    let count = 0;
    for (const s of sections) {
      if (typeof s !== "object" || s === null) {
        say("Ein Abschnitt muss ein Objekt mit «context» und «bindings» sein.");
        continue;
      }
      const sec = s as Record<string, unknown>;
      const context = typeof sec.context === "string" ? sec.context : "map";
      const read = readContext(context);
      if (typeof read === "string") {
        say(`Kontext «${context}»: ${read}`, context);
        continue;
      }
      const bindings = sec.bindings;
      if (typeof bindings !== "object" || bindings === null) {
        say(`Kontext «${context}»: «bindings» fehlt.`, context);
        continue;
      }
      const out: Record<string, string | null> = {};
      for (const [keys, value] of Object.entries(bindings)) {
        if (++count > limits.bindings) {
          say(`Mehr als ${limits.bindings} Bindungen gehen nicht.`);
          break;
        }
        const k = readKeys(keys);
        if (typeof k === "string") {
          say(`«${keys}»: ${k}`, keys);
          continue;
        }
        if (value === null) {
          out[k.join(" ")] = null;
          continue;
        }
        if (typeof value !== "string" || value.length > limits.command) {
          say(`«${keys}»: Erwartet wird ein Befehl als Text oder null.`, keys);
          continue;
        }
        const why = command(value);
        if (why) {
          say(`«${keys}»: ${why}`, keys);
          continue;
        }
        out[k.join(" ")] = value;
      }
      if (Object.keys(out).length)
        keymap.bindings.push({ context, bindings: out });
    }
  }
  const macros = r.macros ?? {};
  if (typeof macros !== "object" || macros === null || Array.isArray(macros))
    say("«macros» muss ein Objekt von Namen zu Befehlen sein.");
  else
    for (const [name, steps] of Object.entries(macros).slice(
      0,
      limits.macros,
    )) {
      const why = macroName(name);
      if (why) {
        say(why, name);
        continue;
      }
      if (typeof steps !== "string" || steps.length > limits.command) {
        say(`Makro «${name}»: Erwartet werden Befehle als Text.`, name);
        continue;
      }
      const bad = command(steps);
      if (bad) {
        say(`Makro «${name}»: ${bad}`, name);
        continue;
      }
      keymap.macros[name] = steps;
    }
  // Scripts are only kept here: they are checked when they start.
  const sources = r.scripts ?? {};
  if (typeof sources !== "object" || sources === null || Array.isArray(sources))
    say("«scripts» muss ein Objekt von Namen zu Quelltexten sein.");
  else {
    const kept: Record<string, string> = {};
    for (const [name, text] of Object.entries(sources).slice(
      0,
      limits.scripts,
    )) {
      const why = macroName(name);
      if (why) {
        say(why.replace("Makroname", "Skriptname"), name);
        continue;
      }
      if (typeof text !== "string" || text.length > limits.source) {
        say(
          `Skript «${name}»: Erwartet wird sein Quelltext, höchstens ${limits.source} Zeichen.`,
          name,
        );
        continue;
      }
      kept[name] = text;
    }
    if (Object.keys(kept).length) keymap.scripts = kept;
  }
  const editor = r.editor as Record<string, unknown> | undefined;
  if (editor && typeof editor === "object" && typeof editor.vim === "boolean")
    keymap.editor = { vim: editor.vim };
  return { keymap, problems };
}

/** Why a macro's name cannot be, or undefined: a slug of 1 to 60 characters. */
export function macroName(name: string): string | undefined {
  if (
    !/^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u.test(name) ||
    name.length > limits.name
  )
    return `«${name}»: Ein Makroname hat Kleinbuchstaben, Ziffern und Bindestriche.`;
  return undefined;
}

/** Reads the keymap's JSON as typed or from a file, with lines for problems. */
export function readJson(
  text: string,
  command: (text: string) => string | undefined,
): { keymap: UserKeymap; problems: Problem[] } {
  if (text.length > limits.json)
    return {
      keymap: { bindings: [], macros: {} },
      problems: [{ text: "Die Tasten-Datei ist zu gross." }],
    };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const at = /position (\d+)/.exec(String(error));
    const line = at
      ? text.slice(0, Number(at[1])).split("\n").length
      : undefined;
    return {
      keymap: { bindings: [], macros: {} },
      problems: [{ text: "Das ist kein gültiges JSON.", line }],
    };
  }
  return check(raw, command, text);
}

/** The visitor's keymap and macros as JSON, to edit or download. */
export function toJson(): string {
  return JSON.stringify(userKeymap(), null, 2);
}

// --- Converting a keymap of version 1 --------------------------------------------

/** Version 1's actions, as commands and the context they now live in. */
const actions1: Record<string, [string, string]> = {
  left: ["left", "map && !text"],
  right: ["right", "map && !text"],
  up: ["up", "map && !text"],
  down: ["down", "map && !text"],
  visual: ["selection:start", "map && !text"],
  other: ["selection:other", "map && !text"],
  apply: ["enter", "map && !text"],
  zoomIn: ["zoom:in", "map"],
  zoomOut: ["zoom:out", "map"],
  fell: ["tool:holzhacken", "map"],
  axe: ["tool:holzhacken", "map"],
  pave: ["tool:pflastern", "map"],
  repair: ["tool:reparieren", "map"],
  demolish: ["tool:abreissen", "map"],
  build: ["menu:build", "map"],
  menu: ["menu:main", "map"],
  texts: ["find:texts", "map"],
  commands: ["find:commands", "map"],
  textLeft: ["text:left", "text"],
  textRight: ["text:right", "text"],
  textUp: ["text:up", "text"],
  textDown: ["text:down", "text"],
  wordNext: ["text:word-next", "text"],
  wordBack: ["text:word-back", "text"],
  wordEnd: ["text:word-end", "text"],
  textStart: ["text:start", "text"],
  textEnd: ["text:end", "text"],
  textVisual: ["text:select", "text"],
  textVisualLine: ["text:select-line", "text"],
  textOther: ["text:other", "text"],
  textCopy: ["text:copy", "text"],
  crewMore: ["crew:more", "card"],
  crewLess: ["crew:less", "card"],
  cardRepair: ["card:repair", "card"],
};

/** Version 1's keys as they were stored: «ArrowUp», « », «Enter», «g». */
function name1(key: string): string {
  return named[key] ?? key;
}

/**
 * A keymap of version 1 (keys per action) as the visitor's bindings of
 * version 2: keys added to an action bound to its command, default keys
 * taken away bound to null.
 */
export function convert(raw: unknown): UserKeymap {
  const out: UserKeymap = { bindings: [], macros: {} };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  const sections = new Map<string, Section>();
  const put = (context: string, keys: string, command: string | null) => {
    let s = sections.get(context);
    if (!s) {
      s = { context, bindings: {} };
      sections.set(context, s);
    }
    s.bindings[keys] = command;
  };
  const defaultKeys = (command: string, context: string) =>
    Object.entries(defaults.find((d) => d.context === context)?.bindings ?? {})
      .filter(([, c]) => c === command)
      .map(([k]) => k);
  for (const [action, [command, context]] of Object.entries(actions1)) {
    const keys = record[action];
    if (!Array.isArray(keys)) continue;
    const now = keys
      .filter((k): k is string => typeof k === "string")
      .slice(0, 8)
      .map(name1)
      // «g» started «gg».
      .map((k) => (action === "textStart" ? `${k} ${k}` : k))
      .filter((k) => typeof readKeys(k) !== "string");
    const before = defaultKeys(command, context);
    for (const k of now) if (!before.includes(k)) put(context, k, command);
    for (const k of before) if (!now.includes(k)) put(context, k, null);
  }
  out.bindings = [...sections.values()];
  return out;
}

// --- The settings database -------------------------------------------------------

const dbName = "waldstatt-games-settings";
const storeName = "settings";
const recordKey = "keys";
const version = 2;
const unlocksKey = "unlocks";

/** What can be unlocked: the scripts, with «niklaus:wirth». */
export type Feature = "scripts";

let unlocks = new Set<Feature>();

/** Whether the visitor unlocked a feature. */
export function unlocked(feature: Feature): boolean {
  return unlocks.has(feature);
}

/** Unlocks a feature for the visitor, in every forest; false if it was. */
export function unlock(feature: Feature): boolean {
  if (unlocks.has(feature)) return false;
  unlocks = new Set([...unlocks, feature]);
  saveUnlocks();
  return true;
}

/**
 * Locks a feature again, in every forest, until it is unlocked anew; false
 * if it was not unlocked.
 */
export function lock(feature: Feature): boolean {
  if (!unlocks.has(feature)) return false;
  unlocks = new Set([...unlocks].filter((f) => f !== feature));
  saveUnlocks();
  return true;
}

function saveUnlocks() {
  for (const listener of listeners) listener();
  void put(unlocksKey, { version: 1, unlocked: [...unlocks] }).catch(
    () => undefined,
  );
}

let opening: Promise<IDBDatabase> | null = null;

/** One connection for the page, so that writes land in the order made. */
function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(storeName))
        r.result.createObjectStore(storeName);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("blocked"));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

async function put(key: string, value: unknown) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error);
  });
}

async function get(key: string): Promise<unknown> {
  const db = await open();
  return new Promise<unknown>((resolve, reject) => {
    const r = db.transaction(storeName).objectStore(storeName).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function write(map: UserKeymap) {
  await put(recordKey, { version, keymap: map });
}

/** Reads what the visitor unlocked; only known features count. */
export function readUnlocks(raw: unknown): Set<Feature> {
  const out = new Set<Feature>();
  const list = (raw as { unlocked?: unknown } | null)?.unlocked;
  if (Array.isArray(list))
    for (const f of list) if (f === "scripts") out.add(f);
  return out;
}

/**
 * Reads what was unlocked and the saved keymap, checking each command with
 * `command`; a keymap of version 1 is converted and stored as version 2. The
 * defaults stay if there is none or it fails.
 */
export async function load(command: (text: string) => string | undefined) {
  try {
    const found = readUnlocks(await get(unlocksKey));
    if (found.size) {
      unlocks = new Set([...unlocks, ...found]);
      for (const listener of listeners) listener();
    }
    const stored = await get(recordKey);
    if (typeof stored !== "object" || stored === null) return;
    const s = stored as { version?: unknown; keys?: unknown; keymap?: unknown };
    if (s.version === 1) {
      const { keymap } = check(convert(s.keys), command);
      use(keymap, true);
    } else if (s.version === version) {
      use(check(s.keymap, command).keymap, false);
    }
  } catch {
    // The browser keeps nothing: the defaults stay for this visit.
  }
}
