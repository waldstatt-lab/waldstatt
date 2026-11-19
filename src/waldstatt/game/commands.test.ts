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
    {
      id: "notify:info",
      args: [{ kind: "text", name: "Text" }],
      describe: ([t]) => `Meldung ${t}`,
      run: ([t]) => void done.push(`notify:${t}`),
    },
  );
  return { c, said, done };
}

describe("reading commands", () => {
  it("reads ids with arguments and defaults", () => {
    const { c } = setup();
    const step = c.parseStep("up(20)");
    expect(typeof step === "string" ? step : step.text).toBe("up(20)");
    const choice = c.parseStep('build("hütte")');
    expect(typeof choice === "string" ? choice : choice.text).toBe(
      "build:hütte",
    );
    const game = c.parseStep("$waldstatt:up(2)");
    expect(typeof game === "string" ? game : game.text).toBe("up(2)");
    const plain = c.parseStep("up");
    expect(typeof plain === "string" ? plain : plain.args).toEqual(["1"]);
  });

  it("explains what is wrong", () => {
    const { c } = setup();
    expect(c.parseStep("nope")).toBe("«nope» ist kein Befehl.");
    expect(c.parseStep("up(x)")).toContain("weder eine Zahl noch ein Text");
    expect(c.parseStep('up("x")')).toBe(
      '«up»: Felder ist eine Zahl, nicht "x".',
    );
    expect(c.parseStep("up(2.5)")).toBe("«2.5» ist keine ganze Zahl.");
    expect(c.parseStep("up:15")).toBe(
      "«up» nimmt seine Werte in Klammern: up(15).",
    );
    expect(c.parseStep("repair:under")).toBe(
      "«repair:under» braucht eine Zahl (Zustand).",
    );
    expect(c.parseStep("build:schloss")).toBe(
      "«schloss» gibt es bei «build» nicht.",
    );
    expect(c.parseStep("up(3, 4)")).toBe("«up» nimmt einen Wert, nicht 2.");
    expect(c.parseStep("notify:info")).toContain("braucht einen Text");
    expect(c.parseStep("up(3")).toContain("«)»");
  });

  it("reads chains and refuses interactive steps in them", () => {
    const { c } = setup();
    const parsed = c.parse("build:hütte; up(3)");
    expect("steps" in parsed && parsed.steps.map((s) => s.text)).toEqual([
      "build:hütte",
      "up(3)",
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

  it("reads texts with every character, and writes them back quoted", () => {
    const { c, done } = setup();
    const text = 'Hütte steht; 12 Holz, "gut" (ja)';
    const written = `notify:info(${JSON.stringify(text)})`;
    const step = c.parseStep(written);
    expect(typeof step === "string" ? step : step.args).toEqual([text]);
    expect(typeof step === "string" ? step : step.text).toBe(written);
    expect(c.runText(`${written};up(2)`)).toBe(true);
    expect(done).toEqual([`notify:${text}`, "up:2"]);
    expect(c.parse('notify:info("offen')).toMatchObject({ step: 1 });
  });

  it("lists commands with the names of their values", () => {
    const { c } = setup();
    const up = c.entries().find((e) => e.text === "up");
    expect(up?.signature).toBe("up(Felder)");
    expect(c.entries().find((e) => e.text === "build:hütte")?.signature).toBe(
      undefined,
    );
  });

  it("runs the scripts' commands supplied from outside", () => {
    const { c } = setup();
    const got: string[][] = [];
    c.setExtra(() => [
      {
        id: "$helfer:bauen:dorf",
        args: [
          { kind: "any", name: "n" },
          { kind: "any", name: "name" },
        ],
        describe: () => "Ein Dorf",
        run: (args) => void got.push(args),
      },
    ]);
    expect(c.runText('$helfer:bauen:dorf(3, "Au")')).toBe(true);
    expect(got).toEqual([["3", '"Au"']]);
    expect(c.entries().map((e) => e.text)).toContain("$helfer:bauen:dorf");
    expect(c.parseStep("$helfer:nix")).toContain("kein Befehl");
  });

  it("checks kept chains, reading scripts' commands only as written", () => {
    const { c } = setup();
    expect(c.check('up(2);$helfer:bauen:dorf(3, "x")')).toBeUndefined();
    expect(c.check("$helfer:bauen:dorf(3")).toContain("«)»");
    expect(c.check("up:2")).toContain("up(2)");
    expect(c.check("up;find:commands")).toContain("nicht in einem Makro");
    expect(c.check("$waldstatt:nix")).toBe("«nix» ist kein Befehl.");
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
    c.runText("up(20)", 2);
    c.runText("up(3)");
    expect(done).toEqual(["up:20", "up:40", "up:3"]);
  });

  it("repeats repeatable commands and whole chains", () => {
    const { c, done } = setup();
    c.runText("crew:more", 3);
    c.runText("build:hütte;up(2)", 2);
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
    c.runText("up(3)");
    c.runText('build("hütte")');
    c.runText("find:commands");
    c.runText("broken");
    expect(c.stopRecording()).toBe("up(5);build:hütte;broken");
    expect(c.last).toBe("up(5);build:hütte;broken");
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
