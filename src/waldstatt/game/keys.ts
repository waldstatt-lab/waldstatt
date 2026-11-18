/**
 * The keymap (ADR 0005): which keys do what, on the map and everywhere
 * outside text fields and dialogs, and in the text mode on a text read
 * top-down (textCursor.ts). Each action can have several keys; within its
 * scope a key belongs to one action at most, so a change that would give it
 * to a second one is refused. The map's and the global actions share one
 * scope, where letters count without regard to Shift, which pans with the
 * movement keys. The text mode is a scope of its own, where Shift counts, as
 * in vim's «G» and «V»; its keys go before the others while it is on.
 * Escape, Tab, the digits (counts before a movement) and keys with Ctrl, Alt
 * or Cmd cannot be bound. The keymap is kept in the
 * IndexedDB database `waldstatt-games-settings`, apart from the forest, so
 * that «Neu beginnen» keeps it. What is read back is untrusted input and is
 * checked like a save.
 */

export type Action =
  | "left"
  | "right"
  | "up"
  | "down"
  | "visual"
  | "other"
  | "apply"
  | "zoomIn"
  | "zoomOut"
  | "fell"
  | "pave"
  | "repair"
  | "demolish"
  | "build"
  | "menu"
  | "texts"
  | "commands"
  | "textLeft"
  | "textRight"
  | "textUp"
  | "textDown"
  | "wordNext"
  | "wordBack"
  | "wordEnd"
  | "textStart"
  | "textEnd"
  | "textVisual"
  | "textVisualLine"
  | "textOther"
  | "textCopy";

/** The map's and the global actions, or the text mode's. */
export type Scope = "map" | "text";

export type Keymap = Record<Action, string[]>;

/** The actions in the order the dialog lists them, with their names. */
export const groups: {
  name: string;
  scope: Scope;
  actions: [Action, string][];
}[] = [
  {
    name: "Auf der Karte",
    scope: "map",
    actions: [
      ["left", "Nach links"],
      ["right", "Nach rechts"],
      ["up", "Nach oben"],
      ["down", "Nach unten"],
      ["visual", "Auswahl beginnen"],
      ["other", "Zur anderen Ecke der Auswahl"],
      ["apply", "Anwenden"],
      ["zoomIn", "Näher"],
      ["zoomOut", "Weiter weg"],
    ],
  },
  {
    name: "Überall",
    scope: "map",
    actions: [
      ["fell", "Holzhacken"],
      ["pave", "Pflastern"],
      ["repair", "Reparieren"],
      ["demolish", "Abreissen"],
      ["build", "Bauen"],
      ["menu", "Menü"],
      ["texts", "Start und Schriften suchen"],
      ["commands", "Befehle"],
    ],
  },
  {
    name: "Im Text, von oben gelesen",
    scope: "text",
    actions: [
      ["textLeft", "Ein Zeichen links"],
      ["textRight", "Ein Zeichen rechts"],
      ["textUp", "Eine Zeile hoch"],
      ["textDown", "Eine Zeile runter"],
      ["wordNext", "Zum nächsten Wort"],
      ["wordBack", "Zum Wortanfang zurück"],
      ["wordEnd", "Zum Wortende"],
      ["textStart", "Zum Anfang (zweimal drücken)"],
      ["textEnd", "Zur letzten Zeile"],
      ["textVisual", "Zeichen auswählen"],
      ["textVisualLine", "Zeilen auswählen"],
      ["textOther", "Zum anderen Ende der Auswahl"],
      ["textCopy", "Auswahl kopieren"],
    ],
  },
];

const scopes = new Map(
  groups.flatMap((g) => g.actions.map(([a]) => [a, g.scope] as const)),
);
/** The scope an action belongs to. */
export const scopeOf = (action: Action): Scope => scopes.get(action) ?? "map";

const names = new Map(groups.flatMap((g) => g.actions));
const actionList = [...names.keys()];

/** The name of an action, such as «Nach links». */
export const actionName = (action: Action) => names.get(action) ?? action;

/** The steps along the tiles of the movement actions. */
export const directions: Partial<Record<Action, [number, number]>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export const defaults: Keymap = {
  left: ["ArrowLeft", "h", "s"],
  right: ["ArrowRight", "l", "e"],
  up: ["ArrowUp", "k", "u"],
  down: ["ArrowDown", "j", "i"],
  visual: ["v"],
  other: ["o"],
  apply: ["Enter", " "],
  zoomIn: ["+", "="],
  zoomOut: ["-", "_"],
  fell: ["a"],
  pave: ["p"],
  repair: ["r"],
  demolish: ["x"],
  build: ["b"],
  menu: ["m"],
  texts: ["/"],
  commands: [":"],
  textLeft: ["ArrowLeft", "h"],
  textRight: ["ArrowRight", "l"],
  textUp: ["ArrowUp", "k"],
  textDown: ["ArrowDown", "j"],
  wordNext: ["w"],
  wordBack: ["b"],
  wordEnd: ["e"],
  textStart: ["g"],
  textEnd: ["G"],
  textVisual: ["v"],
  textVisualLine: ["V"],
  textOther: ["o"],
  textCopy: ["y"],
};

const limits = { keys: 8, length: 24 };

/**
 * A key as the keymap holds it: on the map single letters in lower case, in
 * the text mode as typed.
 */
export const normal = (key: string, scope: Scope = "map") =>
  key.length === 1 && scope === "map" ? key.toLowerCase() : key;

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

/** Why a key cannot be bound, or undefined if it can. */
export function reserved(key: string): string | undefined {
  if (isModifier(key)) return "Diese Taste allein geht nicht.";
  if (key === "Escape") return "Escape bricht immer ab.";
  if (key === "Tab") return "Tab wechselt immer zum nächsten Bedienelement.";
  if (/^[0-9]$/.test(key))
    return "Ziffern sind für Zahlen vor einer Bewegung, wie «10» und dann «→».";
  if (key.length > limits.length || /[\p{Cc}\p{Cf}]/u.test(key))
    return "Diese Taste geht nicht.";
  return undefined;
}

const labels: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Leertaste",
  Enter: "Eingabetaste",
  Backspace: "Rücktaste",
  Delete: "Entf",
  Insert: "Einfg",
  Home: "Pos1",
  End: "Ende",
  PageUp: "Bild↑",
  PageDown: "Bild↓",
};

const spoken: Record<string, string> = {
  ArrowLeft: "Pfeil links",
  ArrowRight: "Pfeil rechts",
  ArrowUp: "Pfeil hoch",
  ArrowDown: "Pfeil runter",
  "/": "Schrägstrich",
  ":": "Doppelpunkt",
  "+": "Plus",
  "-": "Minus",
  "=": "Gleich",
  _: "Unterstrich",
};

/** A key as it is shown, such as «←» or «Leertaste». */
export const keyLabel = (key: string) => labels[key] ?? key;
/** A key as a screen reader says it, such as «Pfeil links» or «Umschalt g». */
export const keySpoken = (key: string) =>
  spoken[key] ??
  (key.length === 1 && key !== key.toLowerCase()
    ? `Umschalt ${key.toLowerCase()}`
    : keyLabel(key));

/** The current keymap; a copy of the defaults until the saved one is read. */
let current: Keymap = copy(defaults);
let byKey = index(current, "map");
let byTextKey = index(current, "text");
const listeners = new Set<() => void>();

function copy(map: Keymap): Keymap {
  return Object.fromEntries(actionList.map((a) => [a, [...map[a]]])) as Keymap;
}

function index(map: Keymap, scope: Scope): Map<string, Action> {
  const keys = new Map<string, Action>();
  for (const action of actionList)
    if (scopeOf(action) === scope)
      for (const key of map[action]) keys.set(key, action);
  return keys;
}

const lookup = (scope: Scope) => (scope === "map" ? byKey : byTextKey);

/** The map's or global action of a pressed key, if any. */
export const actionFor = (key: string) => byKey.get(normal(key));

/** The text mode's action of a pressed key, if any. */
export const textActionFor = (key: string) => byTextKey.get(key);

/** The keys of an action. */
export const keysOf = (action: Action): readonly string[] => current[action];

/** The first key of an action as it is shown, or empty if it has none. */
export const firstKey = (action: Action) =>
  current[action][0] === undefined ? "" : keyLabel(current[action][0]);

/** Calls back after every change, such as to update the help texts. */
export function onChange(listener: () => void) {
  listeners.add(listener);
}

function use(map: Keymap, store: boolean) {
  current = map;
  byKey = index(map, "map");
  byTextKey = index(map, "text");
  for (const listener of listeners) listener();
  if (store) void write(map).catch(() => undefined);
}

/**
 * Adds a key to an action. Returns why it cannot be, naming the action that
 * has it already, or undefined once it is added.
 */
export function bind(action: Action, raw: string): string | undefined {
  const scope = scopeOf(action);
  const key = normal(raw, scope);
  const why = reserved(key);
  if (why) return why;
  const owner = lookup(scope).get(key);
  if (owner === action) return `«${keyLabel(key)}» ist hier schon.`;
  if (owner)
    return `«${keyLabel(key)}» ist schon bei «${actionName(owner)}». Entferne es dort zuerst.`;
  if (current[action].length >= limits.keys)
    return `Mehr als ${limits.keys} Tasten gehen nicht.`;
  const next = copy(current);
  next[action].push(key);
  use(next, true);
  return undefined;
}

export function unbind(action: Action, key: string) {
  const next = copy(current);
  next[action] = next[action].filter((k) => k !== key);
  use(next, true);
}

export function reset() {
  use(copy(defaults), true);
}

/**
 * A keymap read back, checked: known actions only, keys as strings that can
 * be bound, none twice. An action missing from it, such as one added later,
 * gets its default keys that are still free.
 */
export function check(raw: unknown): Keymap | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const taken = { map: new Set<string>(), text: new Set<string>() };
  const map = {} as Keymap;
  const missing: Action[] = [];
  for (const action of actionList) {
    // Holzhacken was the axe and the saw: it takes the axe's keys.
    const keys = record[action] ?? (action === "fell" ? record.axe : undefined);
    if (!Array.isArray(keys)) {
      missing.push(action);
      map[action] = [];
      continue;
    }
    map[action] = [];
    const scope = scopeOf(action);
    for (const key of keys.slice(0, limits.keys)) {
      if (typeof key !== "string" || key !== normal(key, scope)) continue;
      if (reserved(key) || taken[scope].has(key)) continue;
      taken[scope].add(key);
      map[action].push(key);
    }
  }
  for (const action of missing) {
    const scope = scopeOf(action);
    for (const key of defaults[action])
      if (!taken[scope].has(key)) {
        taken[scope].add(key);
        map[action].push(key);
      }
  }
  return map;
}

// --- The settings database -----------------------------------------------------

const dbName = "waldstatt-games-settings";
const storeName = "settings";
const recordKey = "keys";

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

async function write(map: Keymap) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).put({ version: 1, keys: map }, recordKey);
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/** Reads the saved keymap; the defaults stay if there is none or it fails. */
export async function load() {
  try {
    const db = await open();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction(storeName).objectStore(storeName).get(recordKey);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (typeof stored !== "object" || stored === null) return;
    const { version, keys } = stored as { version?: unknown; keys?: unknown };
    const map = version === 1 ? check(keys) : undefined;
    if (map) use(map, false);
  } catch {
    // The browser keeps nothing: the defaults stay for this visit.
  }
}
