import { beforeEach, describe, expect, it } from "vitest";
import {
  bind,
  check,
  convert,
  effective,
  keyLabel,
  keyName,
  keysFor,
  readContext,
  readJson,
  readKeys,
  readUnlocks,
  reserved,
  reset,
  resolve,
  setUserKeymap,
  unbind,
  unshifted,
} from "./keymap";

const ok = () => undefined;
const known = new Set([
  "left",
  "up",
  "enter",
  "text:start",
  "build:hütte",
  "tool:holzhacken",
]);
const command = (text: string) =>
  text.split(";").every((t) => known.has(t.trim()))
    ? undefined
    : `«${text}» ist kein Befehl.`;
const press = (key: string, shiftKey = false) =>
  ({ key, shiftKey }) as KeyboardEvent;

beforeEach(() => {
  // Back to the defaults, without macros, for each test.
  setUserKeymap({ bindings: [], macros: {} });
  reset();
});

describe("key names", () => {
  it("names keys readably", () => {
    expect(keyName(press("ArrowUp"))).toBe("up");
    expect(keyName(press("ArrowUp", true))).toBe("shift-up");
    expect(keyName(press(" "))).toBe("space");
    expect(keyName(press("G", true))).toBe("G");
    expect(keyName(press("Shift", true))).toBeNull();
    expect(unshifted("shift-up")).toBe("up");
    expect(unshifted("G")).toBe("g");
    expect(unshifted("g")).toBeNull();
  });

  it("refuses keys that cannot be bound", () => {
    expect(reserved("escape")).toBeDefined();
    expect(reserved("5")).toBeDefined();
    expect(reserved("shift-g")).toBeDefined();
    expect(reserved("banana")).toBeDefined();
    expect(reserved("f5")).toBeUndefined();
    expect(readKeys("g g")).toEqual(["g", "g"]);
    expect(readKeys("a b c d e")).toBe(
      "Mehr als 4 Tasten nacheinander gehen nicht.",
    );
  });

  it("labels keys and sequences", () => {
    expect(keyLabel(["g", "g"])).toBe("g g");
    expect(keyLabel("shift-up")).toBe("Umschalt+↑");
  });
});

describe("contexts", () => {
  it("reads expressions and how inner they are", () => {
    const c = readContext("map && !text");
    if (typeof c === "string") throw new Error(c);
    expect(c.test(new Set(["map"]))).toBe(true);
    expect(c.test(new Set(["map", "text"]))).toBe(false);
    expect(c.depth).toBe(1);
    const card = readContext("(card || text) && map");
    if (typeof card === "string") throw new Error(card);
    expect(card.depth).toBe(3);
  });

  it("explains what is wrong", () => {
    expect(readContext("kitchen")).toContain("«kitchen» ist kein Kontext");
    expect(readContext("(map")).toBe("Eine Klammer fehlt.");
    expect(readContext("map &&")).toBe("Der Kontext endet zu früh.");
  });
});

describe("resolving keys", () => {
  it("prefers the inner context", () => {
    expect(resolve(["b"], new Set(["map"])).command).toBe("menu:build");
    expect(resolve(["b"], new Set(["map", "text"])).command).toBe(
      "text:word-back",
    );
    // Movement keys rest in the text.
    expect(resolve(["s"], new Set(["map", "text"])).command).toBeUndefined();
  });

  it("knows sequences begun", () => {
    expect(resolve(["g"], new Set(["map", "text"]))).toEqual({
      command: undefined,
      longer: true,
    });
    expect(resolve(["g", "g"], new Set(["map", "text"])).command).toBe(
      "text:start",
    );
  });

  it("layers the visitor's bindings and takes defaults away with null", () => {
    bind(["z"], "map", "build:hütte");
    expect(resolve(["z"], new Set(["map"])).command).toBe("build:hütte");
    const a = effective().find((b) => b.keys.join(" ") === "a");
    if (!a) throw new Error("no a");
    unbind(a);
    expect(resolve(["a"], new Set(["map"])).command).toBeNull();
    expect(keysFor("tool:holzhacken")).toEqual([]);
    reset();
    expect(keysFor("tool:holzhacken")).toEqual([["a"]]);
  });
});

describe("checking a keymap", () => {
  it("keeps what passes and lists problems with lines", () => {
    const text = JSON.stringify(
      {
        bindings: [
          { context: "map", bindings: { z: "build:hütte", "k k": "nope" } },
          { context: "nowhere", bindings: { y: "up" } },
        ],
        macros: { reihe: "build:hütte;up", "Bad Name": "up" },
      },
      null,
      2,
    );
    const { keymap, problems } = readJson(text, command);
    expect(keymap.bindings).toEqual([
      { context: "map", bindings: { z: "build:hütte" } },
    ]);
    expect(keymap.macros).toEqual({ reihe: "build:hütte;up" });
    expect(problems.map((p) => p.text)).toEqual([
      "«k k»: «nope» ist kein Befehl.",
      expect.stringContaining("«nowhere» ist kein Kontext"),
      expect.stringContaining("«Bad Name»"),
    ]);
    expect(problems[0].line).toBe(7);
  });

  it("reports broken JSON", () => {
    expect(readJson("{ nope", ok).problems[0].text).toBe(
      "Das ist kein gültiges JSON.",
    );
  });

  it("refuses what is not a keymap", () => {
    expect(check([], ok).problems).toHaveLength(1);
  });
});

describe("converting version 1", () => {
  it("turns added keys into bindings and removed ones into null", () => {
    const keymap = convert({
      left: ["ArrowLeft", "h", "n"],
      textStart: ["g"],
      axe: ["a"],
    });
    expect(keymap.bindings).toEqual([
      { context: "map && !text", bindings: { n: "left", s: null } },
    ]);
  });
});

describe("unlocks", () => {
  it("reads only known features", () => {
    expect([
      ...readUnlocks({ version: 1, unlocked: ["scripts", "x", 3] }),
    ]).toEqual(["scripts"]);
    expect(readUnlocks(null).size).toBe(0);
    expect(readUnlocks({ unlocked: "scripts" }).size).toBe(0);
  });
});
