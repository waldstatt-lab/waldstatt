import { describe, expect, it } from "vitest";
import { ScriptError } from "./ast";
import { check, type Library } from "./check";
import { compile, type Program, type Value } from "./compile";
import {
  start,
  step,
  validRun,
  type MachineHost,
  type RunState,
} from "./machine";
import { parse } from "./parse";

const library: Library = {
  queries: {
    stock: { args: [0, 0], describe: "Vorräte" },
    time: { args: [0, 0], describe: "Spielzeit" },
    buildings: { args: [0, 1], describe: "Gebäude" },
    "building-at": { args: [2, 2], describe: "Gebäude an einer Stelle" },
    count: { args: [1, 1], describe: "Anzahl" },
  },
  command: (text) =>
    /^(place:hütte|right(:\d+)?|repair:all|up(:\d+)?|repair:under:\d*|(place|up|right|repair:under):)$/.test(
      text,
    )
      ? undefined
      : `«${text}» ist kein Befehl.`,
};

/** A small game: a clock, wood, sites that finish after a while. */
function game() {
  const g = {
    clock: 0,
    wood: 20,
    said: [] as string[],
    ran: [] as string[],
    sites: new Map<number, number>(),
    nextId: 1,
  };
  const host: MachineHost = {
    now: () => g.clock,
    command(text) {
      g.ran.push(text);
      if (text === "place:hütte") {
        if (g.wood < 8) return { error: "Es fehlen 8 Holz." };
        g.wood -= 8;
        const id = g.nextId++;
        g.sites.set(id, g.clock + 10);
        return { work: { kind: "built", ids: [id] } };
      }
      return {};
    },
    query(name, args) {
      if (name === "stock") return { r: { wood: g.wood } };
      if (name === "time") return g.clock;
      if (name === "count") return Array.isArray(args[0]) ? args[0].length : 0;
      if (name === "buildings") return [...g.sites.keys()].map((b) => ({ b }));
      if (name === "building-at") return g.sites.size ? { b: 1 } : null;
      return { error: `«${name}»?` };
    },
    field: (b, name) =>
      name === "state"
        ? (g.sites.get(b) ?? 0) <= g.clock
          ? "done"
          : "site"
        : name === "id"
          ? b
          : { error: `kein Feld ${name}` },
    describe: (b) => `Hütte ${b}`,
    done: (work) =>
      work.ids.every((id) => (g.sites.get(id) ?? Infinity) <= g.clock),
    say: (text) => g.said.push(text),
  };
  return { g, host };
}

function build(scripts: Record<string, string>, name = "main"): Program {
  return compile(check(name, (n) => scripts[n], library));
}

/** Runs a program, advancing the clock a second per frame, up to a limit. */
function play(
  program: Program,
  g: ReturnType<typeof game>["g"],
  host: MachineHost,
  run: RunState = start(program, g.clock),
  seconds = 600,
) {
  const programs = (h: string) => (h === program.hash ? program : undefined);
  for (let t = 0; t < seconds; t++) {
    const { status } = step(run, programs, host, 1000);
    if (status.state === "done" || status.state === "failed")
      return { status, run };
    g.clock += 1;
  }
  return { status: { state: "running" as const }, run };
}

const error = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ScriptError) return `${e.at.line}: ${e.message}`;
    throw e;
  }
  return "no error";
};

describe("reading scripts", () => {
  it("reads blocks, commands, definitions and the header", () => {
    const s = parse(`import holz
every 30s
timeout 10m

qry:genug(n)
  return stock.wood >= n * 8
end

cmd:reihe(n)
  for i in 1..n
    await place:hütte
    right:3
  end
end

if genug(2) then
  reihe:2
elif stock.wood > 0 then
  say "wenig"
else
  wait until genug(2)
end`);
    expect(s.imports.map((i) => i.name)).toEqual(["holz"]);
    expect(s.every?.seconds).toBe(30);
    expect(s.timeout?.seconds).toBe(600);
    expect(s.defs.map((d) => `${d.kind}:${d.name}(${d.params})`)).toEqual([
      "qry:genug(n)",
      "cmd:reihe(n)",
    ]);
    const top = s.body[0];
    expect(top.k).toBe("if");
    if (top.k === "if") {
      expect(top.branches).toHaveLength(2);
      expect(top.otherwise?.[0].k).toBe("until");
    }
  });

  it("reads commands with values and chains", () => {
    const s = parse("repair:under:{n * 2}; up:3 # zwei Befehle");
    expect(s.body.map((x) => x.k)).toEqual(["command", "command"]);
    const c = s.body[0];
    if (c.k === "command") expect(c.text[0]).toBe("repair:under:");
  });

  it("explains mistakes with their line", () => {
    expect(error(() => parse("if x\n  up\nend"))).toBe(
      "1: Die Bedingung endet mit «then».",
    );
    expect(error(() => parse("var x = place:hütte"))).toContain(
      "ein Befehl gibt nichts zurück",
    );
    expect(error(() => parse("genug(3)"))).toContain("ist eine Abfrage");
    expect(error(() => parse("for i in 1..3\n  up"))).toBe(
      "2: Für «for» fehlt das «end».",
    );
    expect(error(() => parse("wait 3x"))).toContain("weder Zahl noch Dauer");
    expect(error(() => parse("up\nimport holz"))).toContain("an den Anfang");
  });
});

describe("checking commands and queries apart", () => {
  const at = (scripts: Record<string, string>) =>
    error(() => check("main", (n) => scripts[n], library));

  it("refuses effects in a query", () => {
    expect(at({ main: "qry:q()\n  up\n  return 1\nend" })).toContain(
      "hat in einer Abfrage nichts verloren",
    );
    expect(at({ main: "qry:q()\n  wait 1s\n  return 1\nend" })).toContain(
      "Abfrage",
    );
    expect(at({ main: "qry:q()\n  return\nend" })).toContain("einen Wert");
  });

  it("refuses values from a command and commands as values", () => {
    expect(at({ main: "cmd:c()\n  return 1\nend" })).toContain(
      "gibt nichts zurück",
    );
    expect(at({ main: "cmd:c()\n  up\nend\nvar x = c()" })).toContain(
      "ist ein Befehl",
    );
    expect(at({ main: "qry:q()\n  return 1\nend\nq:1" })).toContain(
      "ist eine Abfrage",
    );
  });

  it("checks names, values and game commands", () => {
    expect(at({ main: "say x" })).toBe("1: «x» ist unbekannt.");
    expect(at({ main: "var n = 1\nsay n-1" })).toContain("Leerzeichen");
    expect(at({ main: "var a = 1\nif true then\n  var a = 2\nend" })).toContain(
      "gibt es hier schon",
    );
    expect(at({ main: "build:schloss" })).toBe(
      "1: «build:schloss» ist kein Befehl.",
    );
    expect(at({ main: "var n = 3\nrepair:under:{n}" })).toBe("no error");
    expect(at({ main: "cmd:c(a, b)\n  up\nend\nc:1" })).toContain("braucht 2");
    expect(at({ main: "say building-at(1)" })).toContain("braucht 2");
  });

  it("links imports and finds circles and clashes", () => {
    expect(at({ main: "import a\nb:1", a: "cmd:b(n)\n  up:{n}\nend" })).toBe(
      "no error",
    );
    expect(at({ main: "import a", a: "import main" })).toContain("im Kreis");
    expect(
      at({ main: "import a\ncmd:x()\n  up\nend", a: "cmd:x()\n  up\nend" }),
    ).toContain("gibt es schon im Skript");
    expect(at({ main: "import nope" })).toContain("gibt es nicht");
  });
});

describe("running", () => {
  it("computes, loops and says", () => {
    const { g, host } = game();
    const p = build({
      main: `qry:sum(n)
  var s = 0
  for i in 1..n
    s = s + i
  end
  return s
end
var names = ["a", "b"]
var out = ""
for x in names
  out = out + x
end
say "{sum(4)} {out} {count(names)} {10 / 4}"`,
    });
    expect(play(p, g, host).status.state).toBe("done");
    expect(g.said).toEqual(["10 ab 2 2.5"]);
  });

  it("awaits a command's work, then queries what it made", () => {
    const { g, host } = game();
    const p = build({
      main: `await place:hütte
say "{time} {building-at(0, 0).state}"`,
    });
    const { status } = play(p, g, host);
    expect(status.state).toBe("done");
    expect(g.said).toEqual(["10 done"]);
  });

  it("calls the script's own commands with values", () => {
    const { g, host } = game();
    const p = build({
      main: "cmd:reihe(n, gap)\n  for i in 1..n\n    place:hütte\n    right:{gap}\n  end\nend\nreihe:2:3",
    });
    play(p, g, host);
    expect(g.ran).toEqual(["place:hütte", "right:3", "place:hütte", "right:3"]);
  });

  it("waits until a query holds, and times out", () => {
    const { g, host } = game();
    const p = build({
      main: `timeout 5s
  wait until stock.wood > 100
  say "nie"
else
  say "zu lange"
end
say "weiter"`,
    });
    expect(play(p, g, host).status.state).toBe("done");
    expect(g.said).toEqual(["zu lange", "weiter"]);
    expect(g.clock).toBeGreaterThanOrEqual(5);
  });

  it("fails with the line when the whole time is up or a command fails", () => {
    const { g, host } = game();
    const slow = build({ main: "timeout 3s\nwait 10s" });
    const { status } = play(slow, g, host);
    expect(status).toMatchObject({ state: "failed", line: 2 });
    const broke = build({ main: "place:hütte\nplace:hütte\nplace:hütte" });
    expect(play(broke, g, host).status).toMatchObject({
      state: "failed",
      error: "Es fehlen 8 Holz.",
      line: 3,
    });
  });

  it("stops a run that loops forever only by its budget, never freezing", () => {
    const { g, host } = game();
    const p = build({ main: "var n = 0\nwhile true\n  n = n + 1\nend" });
    const run = start(p, 0);
    const { status, steps } = step(run, () => p, host, 500);
    expect(status.state).toBe("running");
    expect(steps).toBe(500);
    void g;
  });

  it("saves a waiting run as data and continues it after a reload", () => {
    const { g, host } = game();
    const p = build({ main: 'var n = 7\nwait 5s\nsay "{n}"' });
    const run = start(p, 0);
    step(run, () => p, host, 1000);
    expect(run.wait?.until).toBe(5);
    // As written to IndexedDB and read back.
    const restored = validRun(JSON.parse(JSON.stringify(run)), p);
    expect(restored).toBeDefined();
    g.clock = 6;
    const { status } = step(restored as RunState, () => p, host, 1000);
    expect(status.state).toBe("done");
    expect(g.said).toEqual(["7"]);
  });

  it("refuses a run read back that does not fit its program", () => {
    const p = build({ main: "up" });
    const run = start(p, 0);
    const bad = JSON.parse(JSON.stringify(run));
    bad.frames[0].pc = 999;
    expect(validRun(bad, p)).toBeUndefined();
    const other = build({ main: "up:2" });
    expect(validRun(run, other)).toBeUndefined();
    expect(
      validRun(
        {
          ...run,
          frames: [{ fn: "main", pc: 0, vars: { x: { evil: 1 } }, stack: [] }],
        },
        p,
      ),
    ).toBeUndefined();
  });

  it("names a program by its compiled form and the machine's version", () => {
    const a = build({ main: "up\n# a comment" });
    const b = build({ main: "up" });
    const c = build({ main: "up:2" });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    const values: Value[] = [1, "x", null, [true], { b: 3 }, { r: { a: 1 } }];
    expect(values).toHaveLength(6);
  });
});
