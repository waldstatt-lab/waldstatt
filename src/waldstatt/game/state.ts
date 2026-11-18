/**
 * The saved state, in the IndexedDB database `waldstatt-games` (ADR 0003):
 * one record with the settlement (stock, buildings, unlocks, flood, camera,
 * seed and more), one with the people, and one per chunk with its felled
 * trees, cobbles and seedlings as bytes. The forest itself is generated
 * (world.ts); only the visitor's changes are saved, and a save writes only
 * the chunks that changed. A snapshot is the whole forest as plain data,
 * for the forests saved under a name and for files (saves.ts, ADR 0004);
 * loading one replaces the saved forest in one transaction. The
 * organization's Pages sites share one origin, so whatever comes back is
 * checked as untrusted input, and a reset deletes only this database and the
 * Waldstatt's old `localStorage` keys.
 */
import {
  balance,
  CHUNK,
  emptyStock,
  goodKeys,
  kinds,
  type Good,
  type Kind,
  type Stock,
} from "./config";
import { start } from "./world";

export const keyPrefix = "waldstatt-games/";
const dbName = "waldstatt-games";
const version = 3;
/** Limits for what a save may hold. */
const limits = {
  buildings: 3000,
  people: balance.maxPeople + 100,
  tombs: 3000,
  list: 40000,
  chunks: 20000,
};

export interface Building {
  id: number;
  kind: Kind;
  /** The game a Spielhaus or Bibliothek belongs to. */
  game?: string;
  /** Top-left tile and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** "drowned": under the Sihlsee; "ruin": worn out, decayed or left by the water. */
  state: "site" | "done" | "drowned" | "ruin";
  /** Seconds of work done; for a ruin being cleared away, of that work. */
  work: number;
  /** Waldleute it asks for, if it takes a crew. */
  crew?: number;
  /**
   * The share of its most condition a finished building has left: 1 sound
   * (or unset), 0 in ruins. Its most condition follows its kind and size.
   */
  condition?: number;
  /** A repair is paid for, and Waldleute come to do it. */
  repair?: boolean;
  /** A ruin the Waldleute clear away. */
  clearing?: boolean;
  /** How far it has sunk into the Sihlsee, 0 to 1. */
  sunk?: number;
  /** Graves in a graveyard. */
  graves?: number;
  /** Loaves thrown at the Brot auswerfen. */
  thrown?: number;
  /** Whether a Spielhaus or the theatre has beer. */
  beer?: boolean;
}

/** A Waldmensch, where they stand and how they are. */
export interface Person {
  id: number;
  sex: "f" | "m";
  /** Years. */
  age: number;
  /** The age at which this life ends. */
  life: number;
  /** Seconds since the last meal. */
  hunger: number;
  /** Age at the last child, for women. */
  lastChild: number;
  x: number;
  y: number;
  /** The producing building this Waldmensch was put in, if any. */
  job?: number;
}

export interface Camera {
  /** Centre in tiles. */
  x: number;
  y: number;
  zoom: number;
}

/** A passing change of motivation: percent now, seconds left and in all. */
export interface MoodEvent {
  amount: number;
  left: number;
  total: number;
}

export interface Saved {
  stock: Stock;
  /** Felled trees: per chunk "cx,cy", a bitset of its tiles. */
  felled: Map<string, Uint8Array>;
  /** Cobbled tiles, the same way. */
  paved: Map<string, Uint8Array>;
  /** Seedlings: per chunk, a byte per tile, how far grown (0 none). */
  growth: Map<string, Uint8Array>;
  /** Tiles planned for cobbles, as "x,y". */
  paving: Set<string>;
  /** Trees marked for felling, as "x,y". */
  marks: Set<string>;
  buildings: Building[];
  nextId: number;
  people: Person[];
  nextPerson: number;
  /** How full the Sihlsee is, 0 to 1; seconds since the flood wave began, or null. */
  flood: { level: number; wave: number | null };
  camera: Camera;
  /** The tools picked up so far. */
  tools: { axe: boolean; saw: boolean };
  /** Where the saw lies, once it has appeared and until it is picked up. */
  sawAt: { x: number; y: number } | null;
  /** Chooses where the hidden texts lie in this forest. */
  seed: number;
  /** Top-left tiles of the hidden texts, by text: "ortstafel", "game:<id>". */
  texts: Map<string, { x: number; y: number }>;
  /** Texts that once lay wholly free. */
  explored: Set<string>;
  /** Buildings that appeared in the build menu. */
  unlocked: Set<Kind>;
  /** Whether something appeared in the build menu since it was last opened. */
  fresh: boolean;
  /** Goods the settlement has had. */
  seen: Set<Good>;
  /** Motivation in percent, and what moves it for a while. */
  mood: number;
  moods: MoodEvent[];
  /** Tombstones outside graveyards. */
  tombs: { x: number; y: number }[];
  /** Waldleute who died, of age and of hunger. */
  deaths: { age: number; hunger: number };
  /** Chunks changed since the last save; not saved itself. */
  dirtyChunks: Set<string>;
}

export function freshState(): Saved {
  const stock = emptyStock();
  return {
    stock,
    felled: new Map(),
    paved: new Map(),
    growth: new Map(),
    paving: new Set(),
    marks: new Set(),
    buildings: [],
    nextId: 1,
    people: [],
    nextPerson: 1,
    flood: { level: 0, wave: null },
    camera: { x: start.x + 0.5, y: start.y + 0.5, zoom: 0 },
    tools: { axe: false, saw: false },
    sawAt: null,
    seed: Math.floor(Math.random() * 0x7fffffff),
    texts: new Map(),
    explored: new Set(),
    unlocked: new Set(),
    fresh: false,
    seen: new Set(),
    mood: 50,
    moods: [],
    tombs: [],
    deaths: { age: 0, hunger: 0 },
    dirtyChunks: new Set(),
  };
}

// --- IndexedDB -----------------------------------------------------------------

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

let opening: Promise<IDBDatabase> | null = null;
/** Set when another tab reset the forest: this tab no longer saves. */
let closed = false;
let onClosed = () => {};

/** Calls back when another tab resets the forest and this one stops saving. */
export function whenClosed(listener: () => void) {
  onClosed = listener;
}

/** Seconds to wait for the database, e.g. while another tab holds it. */
const openTimeout = 5000;

const timeout = <T>(promise: Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("blocked")),
      openTimeout,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Opens the database, at the given version, and adds its stores if missing. */
function connect(at?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName, at);
    r.onupgradeneeded = () => {
      for (const store of ["meta", "chunks"])
        if (!r.result.objectStoreNames.contains(store))
          r.result.createObjectStore(store);
    };
    r.onsuccess = () => {
      const db = r.result;
      // A database without its stores, e.g. left by an interrupted reset:
      // open it once more at the next version, which adds them.
      if (
        !db.objectStoreNames.contains("meta") ||
        !db.objectStoreNames.contains("chunks")
      ) {
        const next = db.version + 1;
        db.close();
        resolve(connect(next));
        return;
      }
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
}

function open(): Promise<IDBDatabase> {
  if (closed) return Promise.reject(new Error("closed"));
  opening ??= timeout(
    connect().then((db) => {
      // Another tab resets the forest or loads another: let go, and save no
      // more here, so this tab cannot write its old forest back.
      db.onversionchange = () => {
        db.close();
        closed = true;
        opening = null;
        onClosed();
      };
      return db;
    }),
  ).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

const bitsetBytes = (CHUNK * CHUNK) / 8;
const growthBytes = CHUNK * CHUNK;

const isInt = (value: unknown, min = -1e7, max = 1e7): value is number =>
  Number.isInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;
const isNum = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const chunkKey = /^-?\d{1,6},-?\d{1,6}$/;
const bytes = (value: unknown, length: number): Uint8Array | undefined =>
  value instanceof Uint8Array && value.length === length ? value : undefined;

/** Reads the saved state; anything invalid starts a fresh forest. */
export async function load(gameIds: Set<string>): Promise<{
  state: Saved;
  problem?: "storage" | "invalid" | "blocked";
}> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch (error) {
    const blocked = error instanceof Error && error.message === "blocked";
    return { state: freshState(), problem: blocked ? "blocked" : "storage" };
  }
  try {
    const tx = db.transaction(["meta", "chunks"], "readonly");
    const meta = tx.objectStore("meta");
    const chunks = tx.objectStore("chunks");
    const [save, people, keys, values] = await Promise.all([
      request(meta.get("save")),
      request(meta.get("people")),
      request(chunks.getAllKeys()),
      request(chunks.getAll()),
    ]);
    if (save === undefined) return { state: freshState() };
    const state = parse(save, people, gameIds);
    if (keys.length > limits.chunks) throw new Error("chunks");
    keys.forEach((k, i) => addChunk(state, k, values[i]));
    return { state };
  } catch {
    return { state: freshState(), problem: "invalid" };
  }
}

/** Adds a chunk record to the state, or throws if it is not one. */
function addChunk(state: Saved, key: unknown, value: unknown) {
  if (typeof key !== "string" || !chunkKey.test(key)) throw new Error("chunk");
  if (typeof value !== "object" || value === null)
    throw new Error("chunk record");
  const record = value as Record<string, unknown>;
  const felled = bytes(record.felled, bitsetBytes);
  const paved = bytes(record.paved, bitsetBytes);
  const growth = bytes(record.growth, growthBytes);
  if (felled) state.felled.set(key, felled);
  if (paved) state.paved.set(key, paved);
  if (growth) state.growth.set(key, growth);
}

/**
 * A whole forest as plain data: the settlement, the people and every chunk,
 * as the database holds them. Saved forests and files are made of it.
 */
export interface Snapshot {
  save: unknown;
  people: unknown;
  chunks: Record<string, ChunkRecord>;
}
type ChunkRecord = Partial<Record<"felled" | "paved" | "growth", Uint8Array>>;

/** The whole forest as plain data, copied. */
export function snapshot(state: Saved): Snapshot {
  const keys = new Set([
    ...state.felled.keys(),
    ...state.paved.keys(),
    ...state.growth.keys(),
  ]);
  const chunks: Record<string, ChunkRecord> = {};
  for (const key of keys) {
    const record = chunkRecord(state, key);
    if (record) chunks[key] = record;
  }
  return { ...records(state), chunks };
}

/**
 * Reads a snapshot from a saved forest or a file, checked like the save;
 * throws if anything in it is invalid.
 */
export function restore(data: unknown, gameIds: Set<string>): Saved {
  if (typeof data !== "object" || data === null) throw new Error("snapshot");
  const d = data as Record<string, unknown>;
  const state = parse(d.save, d.people, gameIds);
  if (typeof d.chunks !== "object" || d.chunks === null)
    throw new Error("chunks");
  const entries = Object.entries(d.chunks);
  if (entries.length > limits.chunks) throw new Error("chunks");
  for (const [key, value] of entries) addChunk(state, key, value);
  return state;
}

function parse(data: unknown, rawPeople: unknown, gameIds: Set<string>): Saved {
  if (typeof data !== "object" || data === null) throw new Error("no object");
  const d = data as Record<string, unknown>;
  if (d.v !== version) throw new Error("version");
  const state = freshState();
  const stock = d.stock as Record<string, unknown> | undefined;
  if (typeof stock !== "object" || stock === null) throw new Error("stock");
  for (const key of goodKeys) {
    const value = stock[key] ?? 0;
    if (!isInt(value, 0, 1e7)) throw new Error(key);
    state.stock[key] = value;
  }
  const pairs = (name: string, into: Set<string>) => {
    const list = d[name];
    if (!Array.isArray(list) || list.length > limits.list * 2)
      throw new Error(name);
    for (let i = 0; i + 1 < list.length; i += 2) {
      const [x, y] = [list[i], list[i + 1]];
      if (!isInt(x) || !isInt(y)) throw new Error(name);
      into.add(`${x},${y}`);
    }
  };
  pairs("marks", state.marks);
  pairs("paving", state.paving);

  if (!Array.isArray(d.buildings) || d.buildings.length > limits.buildings)
    throw new Error("buildings");
  for (const raw of d.buildings) {
    if (typeof raw !== "object" || raw === null) throw new Error("building");
    const b = raw as Record<string, unknown>;
    if (typeof b.kind !== "string" || !Object.hasOwn(kinds, b.kind))
      throw new Error("kind");
    const kind = b.kind as Kind;
    const needsGame = kinds[kind].limit === "game";
    // A game that left the collection takes its buildings with it.
    if (needsGame && (typeof b.game !== "string" || !gameIds.has(b.game)))
      continue;
    if (
      !isInt(b.id, 1) ||
      !isInt(b.x) ||
      !isInt(b.y) ||
      !isInt(b.w, 1, 64) ||
      !isInt(b.h, 1, 400) ||
      !isNum(b.work, 0, 1e6) ||
      !["site", "done", "drowned", "ruin"].includes(b.state as string)
    )
      throw new Error("building fields");
    state.buildings.push({
      id: b.id,
      kind,
      game: needsGame ? (b.game as string) : undefined,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      state: b.state as Building["state"],
      work: b.work,
      crew: isInt(b.crew, 0, 16) ? b.crew : undefined,
      condition: isNum(b.condition, 0, 1) ? b.condition : undefined,
      sunk: isNum(b.sunk, 0, 1) ? b.sunk : undefined,
      graves: isInt(b.graves, 0, 100) ? b.graves : undefined,
      thrown: isInt(b.thrown, 0, 1000) ? b.thrown : undefined,
      beer: b.beer === true ? true : undefined,
      repair: b.repair === true && b.state === "done" ? true : undefined,
      clearing: b.clearing === true && b.state === "ruin" ? true : undefined,
    });
  }
  if (!isInt(d.nextId, 1)) throw new Error("nextId");
  state.nextId = Math.max(d.nextId, ...state.buildings.map((b) => b.id + 1));

  if (!Array.isArray(rawPeople) || rawPeople.length > limits.people)
    throw new Error("people");
  const ids = new Set(state.buildings.map((b) => b.id));
  for (const raw of rawPeople) {
    if (typeof raw !== "object" || raw === null) throw new Error("person");
    const p = raw as Record<string, unknown>;
    if (
      !isInt(p.id, 1) ||
      (p.sex !== "f" && p.sex !== "m") ||
      !isNum(p.age, 0, 200) ||
      !isNum(p.life, 0, 200) ||
      !isNum(p.hunger, 0, 1e5) ||
      !isNum(p.lastChild, -1, 200) ||
      !isNum(p.x, -1e6, 1e6) ||
      !isNum(p.y, -1e6, 1e6)
    )
      throw new Error("person fields");
    state.people.push({
      id: p.id,
      sex: p.sex,
      age: p.age,
      life: p.life,
      hunger: p.hunger,
      lastChild: p.lastChild,
      x: p.x,
      y: p.y,
      job: isInt(p.job, 1) && ids.has(p.job) ? p.job : undefined,
    });
  }
  if (!isInt(d.nextPerson, 1)) throw new Error("nextPerson");
  state.nextPerson = Math.max(
    d.nextPerson,
    ...state.people.map((p) => p.id + 1),
  );

  const flood = d.flood as Record<string, unknown> | undefined;
  if (!flood || !isNum(flood.level, 0, 1)) throw new Error("flood");
  state.flood = {
    level: flood.level,
    wave: isNum(flood.wave, 0, 1e5) ? flood.wave : null,
  };
  const c = d.camera as Record<string, unknown> | undefined;
  if (
    c &&
    isNum(c.x, -1e6, 1e6) &&
    isNum(c.y, -1e6, 1e6) &&
    isNum(c.zoom, 0, 8)
  )
    state.camera = { x: c.x, y: c.y, zoom: c.zoom };
  const tools = d.tools as Record<string, unknown> | undefined;
  state.tools = { axe: tools?.axe === true, saw: tools?.saw === true };
  const sawAt = d.sawAt as Record<string, unknown> | null | undefined;
  if (sawAt && isInt(sawAt.x) && isInt(sawAt.y))
    state.sawAt = { x: sawAt.x, y: sawAt.y };
  if (!isInt(d.seed, 0, 0x7fffffff)) throw new Error("seed");
  state.seed = d.seed;
  if (typeof d.texts !== "object" || d.texts === null) throw new Error("texts");
  const textKey = /^(ortstafel|chronik|game:[a-z0-9-]{1,64})$/;
  for (const [key, value] of Object.entries(d.texts)) {
    const at = value as Record<string, unknown> | null;
    if (!textKey.test(key)) continue;
    if (!at || !isInt(at.x) || !isInt(at.y)) throw new Error("text");
    // A game that left the collection takes its scroll with it.
    if (key.startsWith("game:") && !gameIds.has(key.slice(5))) continue;
    state.texts.set(key, { x: at.x, y: at.y });
  }
  const strings = (name: string, test: (s: string) => boolean) => {
    const list = d[name];
    if (!Array.isArray(list) || list.length > 200) throw new Error(name);
    return list.filter((s): s is string => typeof s === "string" && test(s));
  };
  for (const key of strings("explored", (s) => textKey.test(s)))
    state.explored.add(key);
  for (const kind of strings("unlocked", (s) => Object.hasOwn(kinds, s)))
    state.unlocked.add(kind as Kind);
  for (const good of strings("seen", (s) => goodKeys.includes(s as Good)))
    state.seen.add(good as Good);
  state.fresh = d.fresh === true;
  if (isNum(d.mood, 0, 100)) state.mood = d.mood;
  if (!Array.isArray(d.moods) || d.moods.length > 100) throw new Error("moods");
  for (const raw of d.moods) {
    const m = raw as Record<string, unknown> | null;
    if (
      m &&
      isNum(m.amount, -100, 100) &&
      isNum(m.left, 0, 1e5) &&
      isNum(m.total, 0.01, 1e5)
    )
      state.moods.push({ amount: m.amount, left: m.left, total: m.total });
  }
  if (!Array.isArray(d.tombs) || d.tombs.length > limits.tombs * 2)
    throw new Error("tombs");
  for (let i = 0; i + 1 < d.tombs.length; i += 2) {
    const [x, y] = [d.tombs[i], d.tombs[i + 1]];
    if (!isInt(x) || !isInt(y)) throw new Error("tomb");
    state.tombs.push({ x, y });
  }
  const deaths = d.deaths as Record<string, unknown> | undefined;
  if (deaths && isInt(deaths.age, 0, 1e7) && isInt(deaths.hunger, 0, 1e7))
    state.deaths = { age: deaths.age, hunger: deaths.hunger };
  return state;
}

const pairList = (keys: Iterable<string>) => {
  const list: number[] = [];
  for (const key of keys) {
    const [x, y] = key.split(",").map(Number);
    list.push(x, y);
  }
  return list;
};

const round = (n: number, k: number) => Math.round(n * k) / k;

/** The settlement and the people, as records to store. */
function records(state: Saved): { save: unknown; people: unknown } {
  const save = {
    v: version,
    stock: { ...state.stock },
    marks: pairList(state.marks),
    paving: pairList(state.paving),
    buildings: state.buildings.map((b) => ({ ...b })),
    nextId: state.nextId,
    nextPerson: state.nextPerson,
    flood: { ...state.flood },
    camera: {
      x: round(state.camera.x, 100),
      y: round(state.camera.y, 100),
      zoom: round(state.camera.zoom, 1000),
    },
    tools: { ...state.tools },
    sawAt: state.sawAt && { ...state.sawAt },
    seed: state.seed,
    texts: Object.fromEntries(
      [...state.texts].map(([key, at]) => [key, { ...at }]),
    ),
    explored: [...state.explored],
    unlocked: [...state.unlocked],
    fresh: state.fresh,
    seen: [...state.seen],
    mood: state.mood,
    moods: state.moods.map((m) => ({ ...m })),
    tombs: state.tombs.flatMap((t) => [t.x, t.y]),
    deaths: { ...state.deaths },
  };
  // Only what a person is; what they are doing is found anew.
  const people = state.people.map((p) => ({
    id: p.id,
    sex: p.sex,
    age: round(p.age, 1000),
    life: round(p.life, 1000),
    hunger: round(p.hunger, 10),
    lastChild: round(p.lastChild, 1000),
    x: round(p.x, 100),
    y: round(p.y, 100),
    job: p.job,
  }));
  return { save, people };
}

/** A chunk's record to store, copied, or undefined if nothing changed there. */
function chunkRecord(state: Saved, key: string): ChunkRecord | undefined {
  const record: ChunkRecord = {};
  for (const [name, map] of [
    ["felled", state.felled],
    ["paved", state.paved],
    ["growth", state.growth],
  ] as const) {
    const value = map.get(key);
    if (value) record[name] = value.slice();
  }
  return Object.keys(record).length ? record : undefined;
}

let writing = false;
let again = false;

/**
 * Writes the state: the settlement and the people always, the chunks only
 * when they changed. Returns false if the browser refuses.
 */
export async function save(state: Saved): Promise<boolean> {
  if (writing) {
    again = true;
    return true;
  }
  writing = true;
  try {
    const db = await open();
    const { save, people } = records(state);
    const dirty = [...state.dirtyChunks];
    state.dirtyChunks.clear();
    const tx = db.transaction(["meta", "chunks"], "readwrite");
    tx.objectStore("meta").put(save, "save");
    tx.objectStore("meta").put(people, "people");
    const chunks = tx.objectStore("chunks");
    for (const key of dirty) {
      const record = chunkRecord(state, key);
      if (record) chunks.put(record, key);
      else chunks.delete(key);
    }
    await done(tx).catch((error: unknown) => {
      // Try these chunks again next time.
      for (const key of dirty) state.dirtyChunks.add(key);
      throw error;
    });
    return true;
  } catch {
    return false;
  } finally {
    writing = false;
    if (again) {
      again = false;
      void save(state);
    }
  }
}

/**
 * Replaces the saved forest with another, a saved one or one from a file,
 * in one transaction: if it fails, the old forest stays. Other tabs let go
 * of the database first, and this page saves no more, so that nothing
 * writes the old forest back; the page reloads afterwards. Returns false if
 * the browser refuses.
 */
export async function replaceWith(next: Saved): Promise<boolean> {
  try {
    const current = await open();
    const at = current.version + 1;
    current.onversionchange = null;
    current.close();
    closed = true;
    opening = null;
    // Opening at a higher version makes the other tabs let go of it.
    const db = await timeout(connect(at));
    try {
      const { save, people } = records(next);
      const tx = db.transaction(["meta", "chunks"], "readwrite");
      const meta = tx.objectStore("meta");
      const chunks = tx.objectStore("chunks");
      meta.clear();
      chunks.clear();
      meta.put(save, "save");
      meta.put(people, "people");
      for (const [key, record] of Object.entries(snapshot(next).chunks))
        chunks.put(record, key);
      await done(tx);
    } finally {
      db.close();
    }
    return true;
  } catch {
    closed = true;
    return false;
  }
}

/** Asks the browser to keep the save, which it may grant to installed apps. */
export function keep() {
  void navigator.storage?.persist?.().catch(() => undefined);
}

/** Deletes the Waldstatt's database and its old keys, and only those. */
export async function clearSaved() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(keyPrefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing was saved there.
  }
  closed = true;
  try {
    (await opening)?.close();
  } catch {
    // It never opened.
  }
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(dbName);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
