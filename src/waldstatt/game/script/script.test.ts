import { describe, expect, it } from "vitest";
import { ScriptError } from "./ast";
import { check, type GameCommand, type Library } from "./check";
import { compile, type Program, type Value } from "./compile";
import {
  start,
  startAt,
  step,
  validRun,
  type MachineHost,
  type RunState,
} from "./machine";
import { parse } from "./parse";

const move: GameCommand["args"] = [
  { kind: "number", name: "Felder", min: 1, max: 9999, optional: true },
];
const gameCommands: Record<string, GameCommand["args"]> = {
  place: [
    {
      kind: "choice",
      name: "ein Gebäude",
      optional: false,
      choices: ["hütte"],
    },
  ],
  build: [
    {
      kind: "choice",
      name: "ein Gebäude",
      optional: false,
      choices: ["hütte", "steinhaus"],
    },
  ],
  up: move,
  right: move,
  "repair:all": [],
  "repair:under": [
    { kind: "number", name: "Zustand", min: 1, max: 9999, optional: false },
  ],
  "notify:info": [{ kind: "text", name: "Text", optional: false }],
};

const library: Library = {
  queries: {
    stock: { args: [0, 0], describe: "Vorräte" },
    time: { args: [0, 0], describe: "Spielzeit" },
    buildings: { args: [0, 1], describe: "Gebäude" },
    "building-at": { args: [2, 2], describe: "Gebäude an einer Stelle" },
    count: { args: [1, 1], describe: "Anzahl" },
  },
  command: (head) => {
    const segments = head.split(":");
    for (let n = segments.length; n > 0; n--) {
      const id = segments.slice(0, n).join(":");
      if (gameCommands[id])
        return { id, segments: segments.slice(n), args: gameCommands[id] };
    }
    return `«${segments[0]}» ist kein Befehl.`;
  },
};

/** The game's names without `$`, as every new script starts. */
const W = "import waldstatt\n";

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
      if (/\(\d+\.\d+\)/.test(text))
        return {
          error: `«${/\d+\.\d+/.exec(text)?.[0]}» ist keine ganze Zahl.`,
        };
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
    const s = parse(`import waldstatt
import holz as h
import reihe, bauen:dorf as dorf from helfer
every 30s
timeout 10m

qry:genug(n)
  return stock.wood >= n * 8
end

# Baut eine Reihe.
cmd:bauen:reihe(n)
  for i in 1..n
    await place:hütte
    right(3)
  end
end

if genug(2) then
  bauen:reihe(2)
elif stock.wood > 0 then
  say "wenig"
else
  wait until genug(2)
end`);
    expect(s.imports).toMatchObject([
      { ns: "waldstatt" },
      { ns: "holz", alias: "h" },
      {
        ns: "helfer",
        names: [{ name: "reihe" }, { name: "bauen:dorf", alias: "dorf" }],
      },
    ]);
    expect(s.every?.seconds).toBe(30);
    expect(s.timeout?.seconds).toBe(600);
    expect(s.defs.map((d) => `${d.kind}:${d.name}(${d.params})`)).toEqual([
      "qry:genug(n)",
      "cmd:bauen:reihe(n)",
    ]);
    expect(s.defs[1].doc).toBe("Baut eine Reihe.");
    const top = s.body[0];
    expect(top.k).toBe("if");
    if (top.k === "if") {
      expect(top.branches).toHaveLength(2);
      expect(top.otherwise?.[0].k).toBe("until");
    }
  });

  it("reads commands with values in parentheses, and chains", () => {
    const s = parse(
      'repair:under(n * 2); up(3) # zwei Befehle\n$helfer:bauen:dorf(1, "x;y")',
    );
    expect(s.body.map((x) => x.k)).toEqual(["command", "command", "command"]);
    const [a, , c] = s.body;
    if (a.k === "command") {
      expect(a.name).toBe("repair:under");
      expect(a.args[0].k).toBe("bin");
    }
    if (c.k === "command") {
      expect(c.name).toBe("$helfer:bauen:dorf");
      expect(c.args).toHaveLength(2);
    }
  });

  it("explains mistakes with their line", () => {
    expect(error(() => parse("if x\n  up\nend"))).toBe(
      "1: Die Bedingung endet mit «then».",
    );
    expect(error(() => parse("for i in 1..3\n  up"))).toBe(
      "2: Für «for» fehlt das «end».",
    );
    expect(error(() => parse("wait 3x"))).toContain("weder Zahl noch Dauer");
    expect(error(() => parse("up\nimport holz"))).toContain("an den Anfang");
    // The old forms point to the new one.
    expect(error(() => parse("up:15"))).toContain("up(15)");
    expect(error(() => parse("up:{n}"))).toContain("in Klammern");
    expect(error(() => parse("import a from"))).toContain("So:");
  });
});

describe("checking commands and queries apart", () => {
  const at = (scripts: Record<string, string>) =>
    error(() => check("main", (n) => scripts[n], library));

  it("refuses effects in a query", () => {
    expect(at({ main: W + "qry:q()\n  up\n  return 1\nend" })).toContain(
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
    expect(at({ main: W + "cmd:c()\n  up\nend\nvar x = c()" })).toContain(
      "ist ein Befehl",
    );
    expect(at({ main: W + "var x = place:hütte" })).toContain(
      "gibt nichts zurück",
    );
    expect(at({ main: "qry:q()\n  return 1\nend\nq()" })).toContain(
      "ist eine Abfrage",
    );
    expect(at({ main: W + "stock" })).toContain("ist eine Abfrage");
  });

  it("checks names and the values of game commands", () => {
    expect(at({ main: "say x" })).toBe("1: «x» ist unbekannt.");
    expect(at({ main: "var n = 1\nsay n-1" })).toContain("Leerzeichen");
    expect(at({ main: "var a = 1\nif true then\n  var a = 2\nend" })).toContain(
      "gibt es hier schon",
    );
    expect(at({ main: W + "build:schloss" })).toBe(
      "2: «schloss» gibt es bei «build» nicht.",
    );
    expect(at({ main: W + "var n = 3\nrepair:under(n)" })).toBe("no error");
    expect(at({ main: W + "repair:under" })).toContain("braucht Zustand");
    expect(at({ main: W + 'repair:under("viel")' })).toContain("eine Zahl");
    expect(at({ main: W + "repair:under(0)" })).toContain("1 bis 9999");
    expect(at({ main: W + "up(1, 2)" })).toContain("nimmt 1 Wert");
    expect(at({ main: W + "notify:info(true)" })).toContain("Zahlen und Texte");
    expect(at({ main: W + "cmd:c(a, b)\n  up\nend\nc(1)" })).toContain(
      "braucht 2",
    );
    expect(at({ main: W + "say building-at(1)" })).toContain("braucht 2");
  });

  it("needs `import waldstatt` or `$waldstatt:` for the game's names", () => {
    expect(at({ main: "up(3)" })).toContain("import waldstatt");
    expect(at({ main: "$waldstatt:up(3)\nsay $waldstatt:stock.wood" })).toBe(
      "no error",
    );
    expect(at({ main: "import waldstatt as ws\n$ws:up(3)" })).toBe("no error");
    expect(at({ main: "import waldstatt as ws\n$waldstatt:up(3)" })).toContain(
      "heisst in diesem Skript «$ws»",
    );
    expect(at({ main: "import up from waldstatt\nup(3)" })).toBe("no error");
    expect(
      at({ main: "import repair:under as ru from waldstatt\nru(5)" }),
    ).toBe("no error");
  });

  it("links scripts by import and by `$`, and finds circles and clashes", () => {
    const a = W + "cmd:b(n)\n  up(n)\nend\nqry:q()\n  return 1\nend";
    expect(at({ main: "import a\nb(1)", a })).toBe("no error");
    expect(at({ main: "$a:b(1)\nsay $a:q()", a })).toBe("no error");
    expect(at({ main: "import a as x\n$x:b(1)", a })).toBe("no error");
    expect(at({ main: "import b from a\nb(1)\nsay q()", a })).toContain(
      "«q» gibt es nicht",
    );
    expect(at({ main: "import nix from a", a })).toContain("gibt es im Skript");
    expect(at({ main: "import a", a: "import main" })).toContain("im Kreis");
    expect(at({ main: "$a:x()", a: "$main:y()" })).toContain("im Kreis");
    expect(at({ main: "import nope" })).toContain("gibt es nicht");
    expect(at({ main: "import a\nimport c\nb(1)", a, c: a })).toContain(
      "kommt aus «a» und «c»",
    );
    // A script's own name comes first, the game's after, with a warning.
    const unit = check(
      "main",
      (n) => ({ main: W + "cmd:up()\n  stop\nend\nup" })[n],
      library,
    );
    expect(unit.warnings[0].message).toContain("$waldstatt:up");
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
say "{sum(4)} {out} {$waldstatt:count(names)} {10 / 4}"`,
    });
    expect(play(p, g, host).status.state).toBe("done");
    expect(g.said).toEqual(["10 ab 2 2.5"]);
  });

  it("awaits a command's work, then queries what it made", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}await place:hütte
say "{time} {building-at(0, 0).state}"`,
    });
    const { status } = play(p, g, host);
    expect(status.state).toBe("done");
    expect(g.said).toEqual(["10 done"]);
  });

  it("writes game commands out with their values", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}var kind = "hütte"
var n = 2
up
up(n * 3)
build(kind)
build:steinhaus
notify:info("a, b; \\"c\\"")`,
    });
    expect(play(p, g, host).status.state).toBe("done");
    expect(g.ran).toEqual([
      "up",
      "up(6)",
      'build("hütte")',
      "build:steinhaus",
      'notify:info("a, b; \\"c\\"")',
    ]);
  });

  it("fails where a computed value does not fit", () => {
    const { g, host } = game();
    const p = build({ main: `${W}var n = 15\nup(n / 2)` });
    expect(play(p, g, host).status).toMatchObject({
      state: "failed",
      error: "«7.5» ist keine ganze Zahl.",
      line: 3,
    });
  });

  it("calls the script's own commands, and another script's", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}import helfer as h
cmd:bauen:reihe(n, gap)
  for i in 1..n
    place:hütte
    right(gap)
  end
end
bauen:reihe(2, 3)
$h:winke("hallo")`,
      helfer: 'cmd:winke(text)\n  say "{text}!"\nend',
    });
    play(p, g, host);
    expect(g.ran).toEqual([
      "place:hütte",
      "right(3)",
      "place:hütte",
      "right(3)",
    ]);
    expect(g.said).toEqual(["hallo!"]);
  });

  it("starts a run at one of the script's commands, with values", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}say "oben"\ncmd:bauen:dorf(n, name)\n  say "{name} {n}"\n  up(n)\nend`,
    });
    const run = startAt(p, "main:bauen:dorf", [2, "Dorf"], 0);
    expect(typeof run).not.toBe("string");
    const { status } = play(p, g, host, run as RunState);
    expect(status.state).toBe("done");
    expect(g.said).toEqual(["Dorf 2"]);
    expect(g.ran).toEqual(["up(2)"]);
    expect(startAt(p, "main:bauen:dorf", [1], 0)).toContain("braucht 2");
    expect(startAt(p, "main:nix", [], 0)).toContain("gibt es nicht");
    // Saved and read back, it stays at its command.
    const fresh = startAt(p, "main:bauen:dorf", [1, "x"], 0) as RunState;
    const back = validRun(JSON.parse(JSON.stringify(fresh)), p);
    expect(back?.entry).toBe("main:bauen:dorf");
  });

  it("waits until a query holds, and times out", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}timeout 5s
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

  it("ends an outer timeout on time, though an inner one runs longer", () => {
    const { g, host } = game();
    const p = build({
      main: `${W}timeout 5s
  timeout 60s
    wait until stock.wood > 100
  else
    say "innen"
  end
else
  say "aussen"
end
say "weiter"`,
    });
    expect(play(p, g, host).status.state).toBe("done");
    expect(g.said).toEqual(["aussen", "weiter"]);
    expect(g.clock).toBeLessThan(10);
  });

  it("fails with the line when the whole time is up or a command fails", () => {
    const { g, host } = game();
    const slow = build({ main: "timeout 3s\nwait 10s" });
    const { status } = play(slow, g, host);
    expect(status).toMatchObject({ state: "failed", line: 2 });
    const broke = build({
      main: `${W}place:hütte\nplace:hütte\nplace:hütte`,
    });
    expect(play(broke, g, host).status).toMatchObject({
      state: "failed",
      error: "Es fehlen 8 Holz.",
      line: 4,
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
    const p = build({ main: W + "up" });
    const run = start(p, 0);
    const bad = JSON.parse(JSON.stringify(run));
    bad.frames[0].pc = 999;
    expect(validRun(bad, p)).toBeUndefined();
    const other = build({ main: W + "up(2)" });
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
    expect(validRun({ ...run, entry: "main:nix" }, p)).toBeUndefined();
    // A timeout must jump into the code of a frame the run has.
    for (const t of [
      { deadline: 0, target: -5, depth: 1 },
      { deadline: 0, target: 999, depth: 1 },
      { deadline: 0, target: 0, depth: 0 },
      { deadline: 0, target: 0, depth: 2 },
    ])
      expect(validRun({ ...run, timeouts: [t] }, p)).toBeUndefined();
    expect(
      validRun({ ...run, timeouts: [{ deadline: 0, target: 0, depth: 1 }] }, p),
    ).toBeDefined();
  });

  it("names a program by its compiled form and the machine's version", () => {
    const a = build({ main: W + "up\n# a comment" });
    const b = build({ main: W + "up" });
    const c = build({ main: W + "up(2)" });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    const values: Value[] = [1, "x", null, [true], { b: 3 }, { r: { a: 1 } }];
    expect(values).toHaveLength(6);
  });
});
