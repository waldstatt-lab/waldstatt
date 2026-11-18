/**
 * Forests saved under a name, and forests as files (ADR 0004). Saved forests
 * live in an IndexedDB database of their own, `waldstatt-games-saves`, one
 * record per name with a snapshot of the whole forest (state.ts), so that
 * «Neu beginnen», which deletes the forest being played, leaves them alone.
 * A file is the same snapshot as JSON, with the chunks' bytes in base64.
 * Records and files are untrusted input: they are checked like the save
 * when they are read, before anything is replaced.
 */
import { restore, snapshot, type Saved, type Snapshot } from "./state";

const dbName = "waldstatt-games-saves";
const storeName = "saves";
/** Marks a file as a forest of the Waldstatt. */
const fileFormat = "waldstatt-games";
const limits = {
  name: 60,
  saves: 200,
  /** Bytes of a file; a large settlement takes a few hundred kilobytes. */
  file: 32 * 1024 * 1024,
};

/** A saved forest as the list shows it. */
export interface Entry {
  name: string;
  /** When it was saved, in milliseconds since 1970. */
  at: number;
  people: number;
  buildings: number;
}

interface Stored extends Entry {
  snapshot: Snapshot;
}

/** A name as typed, cleaned: no control characters, single spaces, short. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limits.name)
    .trim();
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

let opening: Promise<IDBDatabase> | null = null;

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

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < 1e7;

/** The saved forests, the newest first; records that make no sense are left out. */
export async function list(): Promise<Entry[]> {
  const db = await open();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const [keys, values] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll()),
  ]);
  const entries: Entry[] = [];
  keys.forEach((key, i) => {
    const v = values[i] as Record<string, unknown> | null;
    if (typeof key !== "string" || key !== cleanName(key) || !key) return;
    if (typeof v !== "object" || v === null) return;
    if (!isCount(v.people) || !isCount(v.buildings)) return;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return;
    entries.push({
      name: key,
      at: v.at,
      people: v.people,
      buildings: v.buildings,
    });
  });
  return entries.sort((a, b) => b.at - a.at);
}

/** Saves the forest under a name, replacing a forest saved under it before. */
export async function put(name: string, state: Saved): Promise<void> {
  const db = await open();
  const record: Stored = {
    name,
    at: Date.now(),
    people: state.people.length,
    buildings: state.buildings.filter((b) => b.state !== "drowned").length,
    snapshot: snapshot(state),
  };
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const [count, existing] = await Promise.all([
    request(store.count()),
    request(store.getKey(name)),
  ]);
  if (existing === undefined && count >= limits.saves) {
    tx.abort();
    throw new Error("full");
  }
  store.put(record, name);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Reads a saved forest; throws if it is missing or invalid. */
export async function get(name: string, gameIds: Set<string>): Promise<Saved> {
  const db = await open();
  const tx = db.transaction(storeName, "readonly");
  const value = (await request(tx.objectStore(storeName).get(name))) as
    Record<string, unknown> | undefined;
  if (typeof value !== "object" || value === null) throw new Error("missing");
  return restore(value.snapshot, gameIds);
}

/** Deletes a saved forest. */
export async function remove(name: string): Promise<void> {
  const db = await open();
  await request(
    db.transaction(storeName, "readwrite").objectStore(storeName).delete(name),
  );
}

// --- Files --------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

const fromBase64 = (text: unknown): Uint8Array | undefined => {
  if (text === undefined) return undefined;
  if (
    typeof text !== "string" ||
    text.length > 8192 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw new Error("base64");
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
};

/** A file name from a forest's name, such as «waldstatt-am-bach-2026-11-18.json». */
function fileName(name: string, at: Date): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const part = slug && slug !== "waldstatt" ? `${slug}-` : "";
  return `waldstatt-${part}${day}.json`;
}

/** Offers the forest as a JSON file to download. */
export function download(name: string, state: Saved) {
  const at = new Date();
  const snap = snapshot(state);
  const chunks: Record<string, Record<string, string>> = {};
  for (const [key, record] of Object.entries(snap.chunks)) {
    const encoded: Record<string, string> = {};
    for (const [field, bytes] of Object.entries(record))
      if (bytes) encoded[field] = toBase64(bytes);
    chunks[key] = encoded;
  }
  const file = {
    format: fileFormat,
    name,
    at: at.toISOString(),
    save: snap.save,
    people: snap.people,
    chunks,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(name, at);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download only after this task.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Reads a forest from a file, with the name it was saved under (or the
 * file's name); throws if it is not a valid forest of the Waldstatt.
 */
export async function upload(
  file: File,
  gameIds: Set<string>,
): Promise<{ name: string; state: Saved }> {
  if (file.size > limits.file) throw new Error("size");
  const data = JSON.parse(await file.text()) as unknown;
  if (typeof data !== "object" || data === null) throw new Error("file");
  const d = data as Record<string, unknown>;
  if (d.format !== fileFormat) throw new Error("format");
  if (typeof d.chunks !== "object" || d.chunks === null)
    throw new Error("chunks");
  const entries = Object.entries(d.chunks);
  if (entries.length > 20000) throw new Error("chunks");
  // Without a prototype, a key such as «__proto__» stays a key, and fails.
  const chunks = Object.create(null) as Snapshot["chunks"];
  for (const [key, value] of entries) {
    if (typeof value !== "object" || value === null) throw new Error("chunk");
    const v = value as Record<string, unknown>;
    const record: Snapshot["chunks"][string] = {};
    for (const field of ["felled", "paved", "growth"] as const) {
      const bytes = fromBase64(v[field]);
      if (bytes) record[field] = bytes;
    }
    chunks[key] = record;
  }
  const state = restore({ save: d.save, people: d.people, chunks }, gameIds);
  const name =
    cleanName(d.name) || cleanName(file.name.replace(/\.json$/i, "")) || "Wald";
  return { name, state };
}
