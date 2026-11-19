import { describe, expect, it } from "vitest";
import { Commands, slug, type Spec } from "./commands";

/** A registry with a few commands that write down what they do. */
function setup() {
  const said: string[] = [];
  const done: string[] = [];
  const c = new Commands((text) => said.push(text));
  const move: Spec = {
    id: "up",
    args: [{ kind: "number", name: "Felder", min: 1, max: 9999, fallback: 1 }],
    count: "number",
    hold: true,
    describe: ([n]) => `${n} hoch`,
    run: ([n]) => void done.push(`up:${n}`),
  };
  c.add(
    move,
    {
      id: "crew:more",
      count: "repeat",
      describe: () => "mehr",
      run: () => void done.push("crew"),
    },
    {
      id: "build",
      args: [
        {
          kind: "choice",
          name: "ein Gebäude",
          choices: () => [{ value: "hütte", label: "Hütte" }],
        },
      ],
      describe: ([b]) => `${b} bauen`,
      run: ([b]) => void done.push(`build:${b}`),
    },
    {
      id: "repair:under",
      args: [{ kind: "number", name: "Zustand", min: 1, max: 9999 }],
      describe: ([n]) => `unter ${n}`,
      run: ([n]) => void done.push(`under:${n}`),
    },
    {
      id: "broken",
      describe: () => "geht nie",
      run: () => "Kaputt.",
    },
    {
      id: "find:commands",
      interactive: true,
      describe: () => "Befehle",
      run: () => void done.push("find"),
    },
  );
  return { c, said, done };
}

describe("reading commands", () => {
  it("reads ids with arguments and defaults", () => {
    const { c } = setup();
    const step = c.parseStep("up:20");
    expect(typeof step === "string" ? step : step.text).toBe("up:20");
    const plain = c.parseStep("up");
    expect(typeof plain === "string" ? plain : plain.args).toEqual(["1"]);
  });

  it("explains what is wrong", () => {
    const { c } = setup();
    expect(c.parseStep("nope")).toBe("«nope» ist kein Befehl.");
    expect(c.parseStep("up:x")).toBe("«x» ist keine Zahl.");
    expect(c.parseStep("repair:under")).toBe(
      "«repair:under» braucht eine Zahl (Zustand).",
    );
    expect(c.parseStep("build:schloss")).toBe(
      "«schloss» gibt es bei «build» nicht.",
    );
    expect(c.parseStep("up:3:4")).toBe("«up:3:4» hat zu viele Teile.");
  });

  it("reads chains and refuses interactive steps in them", () => {
    const { c } = setup();
    const parsed = c.parse("build:hütte; up:3");
    expect("steps" in parsed && parsed.steps.map((s) => s.text)).toEqual([
      "build:hütte",
      "up:3",
    ]);
    expect(c.parse("up;find:commands")).toEqual({
      error: "«find:commands» geht nicht in einem Makro.",
      step: 2,
    });
    expect(c.parse("find:commands")).toHaveProperty("steps");
  });

  it("leaves hidden commands out of the list, but reads them typed out", () => {
    const { c, done } = setup();
    let locked = true;
    c.add({
      id: "secret:word",
      hidden: () => locked,
      describe: () => "Geheim",
      run: () => void done.push("secret"),
    });
    expect(c.entries().map((e) => e.text)).not.toContain("secret:word");
    expect(c.runText("secret:word")).toBe(true);
    expect(done).toEqual(["secret"]);
    locked = false;
    expect(c.entries().map((e) => e.text)).toContain("secret:word");
  });

  it("makes slugs of names", () => {
    expect(slug("  Meinrads Klause ")).toBe("meinrads-klause");
    expect(slug("Wald: am Bach")).toBe("wald-am-bach");
  });
});

describe("running", () => {
  it("lets a count stand for the number or multiply it", () => {
    const { c, done } = setup();
    c.runText("up", 20);
    c.runText("up:20", 2);
    c.runText("up:3");
    expect(done).toEqual(["up:20", "up:40", "up:3"]);
  });

  it("repeats repeatable commands and whole chains", () => {
    const { c, done } = setup();
    c.runText("crew:more", 3);
    c.runText("build:hütte;up:2", 2);
    expect(done).toEqual([
      "crew",
      "crew",
      "crew",
      "build:hütte",
      "up:2",
      "build:hütte",
      "up:2",
    ]);
  });

  it("stops a chain at the first step that fails, and says where", () => {
    const { c, done, said } = setup();
    expect(c.runText("up;broken;up")).toBe(false);
    expect(done).toEqual(["up:1"]);
    expect(said).toEqual(["Makro hält bei Schritt 2 von 3 (broken): Kaputt."]);
  });

  it("refuses a macro that runs itself", () => {
    const { c, said } = setup();
    c.add({
      id: "loop",
      describe: () => "Schleife",
      run: () => (c.runMacro("loop", "loop") ? undefined : ""),
    });
    expect(c.runMacro("loop", "loop")).toBe(false);
    expect(said.at(-1)).toBe(
      "Das Makro «loop» kann sich nicht selbst ausführen.",
    );
  });

  it("limits the steps of one run", () => {
    const { c, said } = setup();
    expect(c.runText("crew:more", 9999)).toBe(true);
    expect(c.runText("up;up", 9999)).toBe(false);
    expect(said.at(-1)).toContain("Mehr als 10000 Schritte");
  });
});

describe("recording", () => {
  it("writes down what was run, adding up moves in a row", () => {
    const { c } = setup();
    c.startRecording();
    c.runText("up", 2);
    c.runText("up:3");
    c.runText("build:hütte");
    c.runText("find:commands");
    c.runText("broken");
    expect(c.stopRecording()).toBe("up:5;build:hütte;broken");
    expect(c.last).toBe("up:5;build:hütte;broken");
  });

  it("does not record the steps inside a macro run", () => {
    const { c } = setup();
    c.add({
      id: "macro:run",
      describe: () => "Makro",
      run: () => void c.runMacro("m", "build:hütte;up"),
    });
    c.startRecording();
    c.runText("macro:run");
    expect(c.stopRecording()).toBe("macro:run");
  });
});
