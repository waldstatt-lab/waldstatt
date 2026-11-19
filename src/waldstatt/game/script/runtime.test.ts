import { describe, expect, it } from "vitest";
import type { Library } from "./check";
import { Runtime, type RuntimeHost } from "./runtime";

const library: Library = {
  queries: { time: { args: [0, 0], describe: "Spielzeit" } },
  command: (head) =>
    head === "up"
      ? {
          id: "up",
          segments: [],
          args: [
            { kind: "number", name: "Felder", min: 1, max: 9, optional: true },
          ],
        }
      : `«${head}» ist kein Befehl.`,
};

function setup(scripts: Record<string, string>) {
  const g = {
    clock: 0,
    ran: [] as string[],
    said: [] as string[],
    told: [] as string[],
    unlocked: true,
  };
  const host: RuntimeHost = {
    library,
    source: (name) => scripts[name],
    names: () => Object.keys(scripts),
    announce: (text) => g.told.push(text),
    now: () => g.clock,
    command: (text) => {
      g.ran.push(text);
      return {};
    },
    query: (name) => (name === "time" ? g.clock : { error: name }),
    field: () => null,
    describe: (b) => `#${b}`,
    done: () => true,
    say: (text) => g.said.push(text),
    unlocked: () => g.unlocked,
  };
  const runtime = new Runtime(host);
  // Switched on in this forest, unless a test says otherwise.
  for (const name of Object.keys(scripts)) runtime.enable(name, true);
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      runtime.tick();
      g.clock += 1;
    }
  };
  return { g, host, runtime, advance, scripts };
}

describe("the runtime", () => {
  it("starts a script once at a time and stops it", () => {
    const { runtime, g, advance } = setup({ a: 'wait 5s\nsay "fertig"' });
    expect(runtime.start("a")).toBeUndefined();
    expect(runtime.start("a")).toBe("«a» läuft schon.");
    expect(runtime.state("a").state).toBe("running");
    advance(2);
    expect(runtime.state("a").state).toBe("waiting");
    advance(10);
    expect(g.said).toEqual(["fertig"]);
    expect(runtime.state("a").state).toBe("idle");
    runtime.start("a");
    expect(runtime.stop("a")).toBe(true);
    expect(runtime.runs).toHaveLength(0);
  });

  it("refuses scripts that do not check, saying where", () => {
    const { runtime } = setup({ a: "say x" });
    expect(runtime.start("a")).toBe("«a», Zeile 1: «x» ist unbekannt.");
  });

  it("starts `every` scripts on game time, never twice at once", () => {
    const { runtime, g, advance } = setup({
      tick: "import waldstatt\nevery 10s\nup\nwait 15s",
    });
    advance(31);
    // At 0 it starts and waits 15s; at 10 it still runs and is skipped; at
    // 20 it starts again.
    expect(g.ran).toEqual(["up", "up"]);
    expect(runtime.next("tick")).toBe(40);
  });

  it("keeps the old version for a run under way after an edit", () => {
    const { runtime, g, advance, scripts } = setup({ a: 'wait 5s\nsay "alt"' });
    runtime.start("a");
    advance(1);
    scripts.a = 'say "neu"';
    expect(runtime.state("a").state).toBe("older");
    advance(10);
    expect(g.said).toEqual(["alt"]);
    runtime.start("a");
    advance(1);
    expect(g.said).toEqual(["alt", "neu"]);
  });

  it("saves runs with their programs and continues them after a reload", () => {
    const first = setup({ a: 'var n = 41\nwait 5s\nsay "{n + 1}"' });
    first.runtime.start("a");
    first.advance(2);
    const saved = JSON.parse(JSON.stringify(first.runtime.save()));
    // The script was edited meanwhile; the run keeps its own version.
    const second = setup({ a: 'say "anders"' });
    second.g.clock = first.g.clock;
    expect(second.runtime.load(saved)).toBe(0);
    expect(second.runtime.state("a").state).toBe("older");
    second.advance(10);
    expect(second.g.said).toEqual(["42"]);
  });

  it("drops runs whose program does not compile to the same thing", () => {
    const first = setup({ a: "import waldstatt\nwait 5s\nup" });
    first.runtime.start("a");
    first.advance(1);
    const saved = JSON.parse(JSON.stringify(first.runtime.save()));
    const h = Object.keys(saved.programs)[0];
    saved.programs[h].sources.a = "import waldstatt\nwait 5s\nup(2)";
    const second = setup({ a: "import waldstatt\nup" });
    expect(second.runtime.load(saved)).toBe(1);
    expect(second.runtime.runs).toHaveLength(0);
    expect(second.runtime.load({ ...saved, version: 999 })).toBe(1);
  });

  it("records a failure until the script starts again", () => {
    const { runtime, g, advance } = setup({ a: "var x = 1 / 0" });
    runtime.start("a");
    advance(1);
    expect(runtime.state("a")).toMatchObject({ state: "failed", line: 1 });
    expect(g.told[0]).toBe(
      "Skript «a» hält an, Zeile 1: Durch null teilen geht nicht.",
    );
  });

  it("runs nothing until scripts are unlocked", () => {
    const { runtime, g, advance } = setup({
      a: "import waldstatt\nup",
      tick: "import waldstatt\nevery 10s\nup",
    });
    g.unlocked = false;
    expect(runtime.start("a")).toBe("Skripte sind nicht freigeschaltet.");
    advance(20);
    expect(g.ran).toEqual([]);
    g.unlocked = true;
    advance(1);
    expect(g.ran).toEqual(["up"]);
  });

  it("runs only scripts switched on in this forest", () => {
    const { runtime, g, advance } = setup({
      a: "wait 50s",
      tick: "import waldstatt\nevery 10s\nup",
    });
    runtime.enable("tick", false);
    advance(20);
    expect(g.ran).toEqual([]);
    runtime.start("a");
    runtime.enable("a", false);
    expect(runtime.runs).toHaveLength(0);
    expect(runtime.start("a")).toBe(
      "«a» ist in diesem Wald nicht eingeschaltet.",
    );
  });

  it("keeps which scripts are switched on with the forest", () => {
    const first = setup({ a: "say 1", b: "say 2" });
    first.runtime.enable("b", false);
    const saved = JSON.parse(JSON.stringify(first.runtime.save()));
    expect(saved.enabled).toEqual(["a"]);
    const second = setup({ a: "say 1", b: "say 2" });
    second.runtime.load(saved);
    expect(second.runtime.enabled("a")).toBe(true);
    expect(second.runtime.enabled("b")).toBe(false);
    // Saved before forests switched scripts on: those that ran stay on.
    const third = setup({ a: "wait 5s", b: "say 2" });
    third.runtime.start("a");
    const old = JSON.parse(JSON.stringify(third.runtime.save()));
    delete old.enabled;
    const fourth = setup({ a: "wait 5s", b: "say 2" });
    expect(fourth.runtime.load(old)).toBe(0);
    expect(fourth.runtime.runs).toHaveLength(1);
    expect(fourth.runtime.enabled("b")).toBe(false);
  });

  it("starts a run at a script's command, once at a time", () => {
    const { runtime, g, advance } = setup({
      helfer: "import waldstatt\ncmd:bauen:dorf(n)\n  wait 2s\n  up(n)\nend",
    });
    expect(runtime.startAt("helfer", "bauen:dorf", [3])).toBeUndefined();
    expect(runtime.startAt("helfer", "bauen:dorf", [3])).toContain(
      "läuft schon",
    );
    expect(runtime.state("helfer").state).toBe("running");
    advance(5);
    expect(g.ran).toEqual(["up(3)"]);
    expect(runtime.runs).toHaveLength(0);
    expect(runtime.startAt("helfer", "bauen:dorf", [])).toContain("braucht 1");
    runtime.enable("helfer", false);
    expect(runtime.startAt("helfer", "bauen:dorf", [1])).toContain(
      "nicht eingeschaltet",
    );
  });

  it("names the script whose run is stepping, and shows failures", () => {
    const scripts = { a: 'say "x"', b: "var x = 1 / 0" };
    const { runtime, host, advance } = setup(scripts);
    const seen: (string | undefined)[] = [];
    const alerts: string[] = [];
    host.say = () => seen.push(runtime.stepping);
    host.alert = (script, text) => alerts.push(`${script}: ${text}`);
    runtime.start("a");
    runtime.start("b");
    advance(2);
    expect(seen).toEqual(["a"]);
    expect(alerts[0]).toContain("b: hält an, Zeile 1");
    expect(runtime.stepping).toBeUndefined();
  });

  it("runs at most eight scripts at once", () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < 9; i++) scripts[`s${i}`] = "wait 100s";
    const { runtime } = setup(scripts);
    for (let i = 0; i < 8; i++) expect(runtime.start(`s${i}`)).toBeUndefined();
    expect(runtime.start("s8")).toContain("Mehr als 8");
  });
});
