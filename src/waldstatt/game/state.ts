/**
 * The saved state: one versioned JSON document in localStorage under
 * `waldstatt-games/save`. The forest itself is generated (world.ts); only the
 * visitor's changes are saved. The organization's Pages sites share one
 * origin, and with it localStorage, so every key of the Waldstatt starts with
 * `waldstatt-games/`, the saved text is treated as untrusted input, and a reset
 * removes only those keys.
 */
import { CHUNK, kinds, type Kind } from "./config";

export const keyPrefix = "waldstatt-games/";
const saveKey = `${keyPrefix}save`;
const version = 1;
/** Saves larger than this are not read; the game starts over instead. */
const maxChars = 2_000_000;

export interface Building {
  id: number;
  kind: Kind;
  /** The game a Spielhaus, Spielidee or Anleitung belongs to. */
  game?: string;
  /** Top-left tile and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  state: "site" | "done" | "drowned";
  /** Seconds of work done. */
  work: number;
}

export interface Camera {
  /** Centre in tiles. */
  x: number;
  y: number;
  zoom: number;
}

export interface Saved {
  wood: number;
  parchment: number;
  prints: number;
  /** Felled trees: per chunk "cx,cy", a bitset of its tiles. */
  felled: Map<string, Uint8Array>;
  /** Trees marked for felling, as "x,y". */
  marks: Set<string>;
  buildings: Building[];
  nextId: number;
  flooded: boolean;
  camera: Camera;
  /** How far the Waldmensch's hints have got. */
  hint: number;
}

export function freshState(): Saved {
  return {
    wood: 0,
    parchment: 0,
    prints: 0,
    felled: new Map(),
    marks: new Set(),
    buildings: [],
    nextId: 1,
    flooded: false,
    camera: { x: 0.5, y: 0.5, zoom: 0 },
    hint: 0,
  };
}

const bitsetBytes = (CHUNK * CHUNK) / 8;

function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function decode(text: string): Uint8Array | undefined {
  try {
    const raw = atob(text);
    if (raw.length !== bitsetBytes) return undefined;
    const bytes = new Uint8Array(bitsetBytes);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

const isInt = (value: unknown, min = -1e7, max = 1e7): value is number =>
  Number.isInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;
const isNum = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

/** Reads the saved state; anything invalid starts a fresh forest. */
export function load(gameIds: Set<string>): {
  state: Saved;
  problem?: string;
} {
  let text: string | null = null;
  try {
    text = localStorage.getItem(saveKey);
  } catch {
    return { state: freshState(), problem: "storage" };
  }
  if (!text) return { state: freshState() };
  try {
    if (text.length > maxChars) throw new Error("too large");
    return { state: parse(JSON.parse(text), gameIds) };
  } catch {
    return { state: freshState(), problem: "invalid" };
  }
}

function parse(data: unknown, gameIds: Set<string>): Saved {
  if (typeof data !== "object" || data === null) throw new Error("no object");
  const d = data as Record<string, unknown>;
  if (d.v !== version) throw new Error("version");
  const state = freshState();
  for (const name of ["wood", "parchment", "prints"] as const) {
    if (!isInt(d[name], 0, 1e7)) throw new Error(name);
    state[name] = d[name] as number;
  }
  if (typeof d.felled !== "object" || d.felled === null)
    throw new Error("felled");
  for (const [key, value] of Object.entries(d.felled)) {
    if (!/^-?\d{1,6},-?\d{1,6}$/.test(key) || typeof value !== "string")
      throw new Error("felled entry");
    const bytes = decode(value);
    if (!bytes) throw new Error("felled bits");
    state.felled.set(key, bytes);
  }
  if (!Array.isArray(d.marks) || d.marks.length > 40000)
    throw new Error("marks");
  for (let i = 0; i + 1 < d.marks.length; i += 2) {
    const x = d.marks[i];
    const y = d.marks[i + 1];
    if (!isInt(x) || !isInt(y)) throw new Error("mark");
    state.marks.add(`${x},${y}`);
  }
  if (!Array.isArray(d.buildings) || d.buildings.length > 2000)
    throw new Error("buildings");
  for (const raw of d.buildings) {
    if (typeof raw !== "object" || raw === null) throw new Error("building");
    const b = raw as Record<string, unknown>;
    if (typeof b.kind !== "string" || !Object.hasOwn(kinds, b.kind))
      throw new Error("kind");
    const kind = b.kind as Kind;
    const needsGame = kinds[kind].limit === "game";
    if (needsGame && (typeof b.game !== "string" || !gameIds.has(b.game))) {
      // A game that left the collection takes its buildings with it.
      continue;
    }
    if (
      !isInt(b.id, 1) ||
      !isInt(b.x) ||
      !isInt(b.y) ||
      !isInt(b.w, 1, 64) ||
      !isInt(b.h, 1, 400) ||
      !isNum(b.work, 0, 1e6) ||
      (b.state !== "site" && b.state !== "done" && b.state !== "drowned")
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
      state: b.state,
      work: b.work,
    });
  }
  if (!isInt(d.nextId, 1)) throw new Error("nextId");
  state.nextId = Math.max(d.nextId, ...state.buildings.map((b) => b.id + 1));
  state.flooded = d.flooded === true;
  const c = d.camera as Record<string, unknown> | undefined;
  if (
    c &&
    isNum(c.x, -1e6, 1e6) &&
    isNum(c.y, -1e6, 1e6) &&
    isNum(c.zoom, 0, 8)
  )
    state.camera = { x: c.x, y: c.y, zoom: c.zoom };
  if (isInt(d.hint, 0, 100)) state.hint = d.hint;
  return state;
}

/** Writes the state; returns false if the browser refuses. */
export function save(state: Saved): boolean {
  const felled: Record<string, string> = {};
  for (const [key, bytes] of state.felled) felled[key] = encode(bytes);
  const marks: number[] = [];
  for (const key of state.marks) {
    const [x, y] = key.split(",").map(Number);
    marks.push(x, y);
  }
  const data = {
    v: version,
    wood: state.wood,
    parchment: state.parchment,
    prints: state.prints,
    felled,
    marks,
    buildings: state.buildings,
    nextId: state.nextId,
    flooded: state.flooded,
    camera: {
      x: Math.round(state.camera.x * 100) / 100,
      y: Math.round(state.camera.y * 100) / 100,
      zoom: Math.round(state.camera.zoom * 1000) / 1000,
    },
    hint: state.hint,
  };
  try {
    localStorage.setItem(saveKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Removes the Waldstatt's keys, and only those. */
export function clearSaved() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(keyPrefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing was saved, so there is nothing to remove.
  }
}
