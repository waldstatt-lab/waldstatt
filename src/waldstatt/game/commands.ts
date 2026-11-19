/**
 * The commands (ADR 0006, ADR 0008): everything the keyboard and the «:»
 * finder can do, by name. A command's id is a path of colon segments; its
 * values follow in parentheses: `up`, `up(20)`, `repair:under(5)`,
 * `notify:info("Hallo")`. A choice from a list may stand as a further
 * segment, as `build:hütte`, or in the parentheses, as `build("hütte")`.
 * `$waldstatt:` before a command names the game's explicitly; the commands
 * of the players' scripts are `$script:name(…)`, supplied from outside.
 * Namespaces and verbs are English identifiers; names of things are as the
 * game names them, as lower-case slugs. Each command describes itself in
 * German, says why it cannot run now, and says how a count typed before its
 * key combines with it. A macro is a chain of commands joined by «;», run in
 * order and stopped at the first step that cannot run; a count repeats the
 * whole chain. While recording, every command run is written down, so it can
 * be replayed or kept as a named macro. Keys bind to commands (keymap.ts);
 * the dispatcher runs them (dispatch.ts).
 */

import { readCall, segmentSafe, splitChain, type Literal } from "./commandText";
import type { Work } from "./script/machine";

/** The places a binding can apply: where the keyboard is and what is open. */
export type Context = "map" | "placing" | "reading" | "text" | "card";

export const contexts: Context[] = [
  "map",
  "placing",
  "reading",
  "text",
  "card",
];

/** One value a choice argument takes: its slug, and what it is called. */
export interface Choice {
  value: string;
  label: string;
  /**
   * Left out of the finder's list, but valid when typed out, such as a
   * script switched off in this forest for `script:run`.
   */
  unlisted?: boolean;
}

export type Arg =
  | {
      kind: "number";
      /** What the number is, for the finder, such as «Felder». */
      name: string;
      min: number;
      max: number;
      /** The number when none is given; without, one is needed. */
      fallback?: number;
    }
  | { kind: "choice"; name: string; choices(): Choice[] }
  /** A text, written in quotes. */
  | { kind: "text"; name: string; max?: number }
  /** A number or a text, kept as written (JSON), for scripts' commands. */
  | { kind: "any"; name: string };

export interface Spec {
  /** The fixed segments, such as `repair:under`. */
  id: string;
  args?: Arg[];
  /** What it does with these arguments, in German. */
  describe(args: string[]): string;
  /** Why it cannot run now, in German; undefined if it can. */
  unavailable?(args: string[]): string | undefined;
  /**
   * Runs it; returns why it failed, in German, if it did, or the work it
   * left, which a script can await (ADR 0007).
   */
  run(args: string[]): string | void | Work;
  /**
   * How a count typed before its key combines with it: as its number (or its
   * number times the count), as so many runs, or not at all (the default).
   */
  count?: "number" | "repeat";
  /** Held down, it runs again and again at the map's pace (the movements). */
  hold?: boolean;
  /** With Shift held, the view pans this way instead. */
  pan?: [number, number];
  /** It runs again with the keyboard's own repeat (the text cursor). */
  repeats?: boolean;
  /** It runs with focus anywhere on the page, not only on the map. */
  global?: boolean;
  /**
   * It cannot be a macro step and is not recorded: it opens a menu, a finder
   * or a dialog, or changes keys or macros.
   */
  interactive?: boolean;
  /** Arguments the finder offers as examples, such as `repair:under(10)`. */
  examples?: string[][];
  /**
   * Left out of the finder's list and the completions now: it runs only
   * when typed out, such as a cheat or the scripts before they are unlocked.
   */
  hidden?(): boolean;
}

/** A command with its arguments, ready to run. */
export interface Step {
  spec: Spec;
  args: string[];
  /** As it is written, such as `up(20)`. */
  text: string;
}

/** A chain read from text, or why it cannot be. */
export type Parsed =
  | { steps: Step[] }
  | { error: string; /** The step, counted from 1. */ step: number };

/** What the finder lists: a command as written, what it does, and why not. */
export interface Entry {
  text: string;
  description: string;
  why?: string;
  /** Its values by name, such as `up(Felder)`, if it takes any. */
  signature?: string;
}

/** A command's values, as the script checker needs them (ADR 0008). */
export interface ArgInfo {
  kind: Arg["kind"];
  name: string;
  min?: number;
  max?: number;
  /** Whether it may be left out. */
  optional: boolean;
  /** The values a choice takes. */
  choices?: string[];
}

/** A command found by its segments as written in a script. */
export interface CommandInfo {
  id: string;
  args: ArgInfo[];
  /** The segments after the id, as values of its first choices. */
  segments: string[];
}

/** The id of the game's namespace (ADR 0008). */
export const gameNamespace = "waldstatt";

const limits = {
  /** Steps in one macro. */
  steps: 200,
  /** Steps in one run, its repetitions included. */
  run: 10000,
  /** Macros running inside each other. */
  depth: 8,
  count: 9999,
};

/** A name as a segment: lower case, hyphens for spaces, no colons. */
export const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s:;]+/g, "-")
    .replace(/^-+|-+$/g, "");

export class Commands {
  private specs: Spec[] = [];
  private byId = new Map<string, Spec>();
  /** The recording under way, as the steps written so far. */
  private recording: { spec: Spec; args: string[] }[] | null = null;
  /** The commands of the players' scripts, `$script:name`, as they are now. */
  private extra: () => Spec[] = () => [];
  /** The last recording, which `macro:replay` runs. */
  last = "";
  /** The macros running now, by name, to refuse running one inside itself. */
  private running: string[] = [];
  /** Steps run in the current outermost run. */
  private budget = 0;
  /** Runs inside each other now: 1 for a key's or the finder's own. */
  private nesting = 0;
  private listeners = new Set<() => void>();

  constructor(private announce: (text: string) => void) {}

  add(...specs: Spec[]) {
    for (const spec of specs) {
      this.specs.push(spec);
      this.byId.set(spec.id, spec);
    }
  }

  /** Supplies the commands of the players' scripts (ADR 0008). */
  setExtra(extra: () => Spec[]) {
    this.extra = extra;
  }

  private find(id: string): Spec | undefined {
    return (
      this.byId.get(id) ??
      (id.startsWith("$") ? this.extra().find((s) => s.id === id) : undefined)
    );
  }

  /** Calls back when a recording starts or ends. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  // --- Reading commands --------------------------------------------------------

  /**
   * Reads one command, such as `repair:under(5)` or `build:hütte`, or why it
   * is not one.
   */
  parseStep(text: string): Step | string {
    const call = readCall(text);
    if (typeof call === "string") return call;
    let head = call.head;
    if (head.startsWith(`$${gameNamespace}:`))
      head = head.slice(gameNamespace.length + 2);
    const segments = head.split(":");
    if (segments.some((s) => !s))
      return `«${head}»: zwischen zwei Doppelpunkten fehlt etwas.`;
    for (let n = segments.length; n > 0; n--) {
      const spec = this.find(segments.slice(0, n).join(":"));
      if (spec) return fill(spec, segments.slice(n), call.values);
    }
    if (head.startsWith("$"))
      return `«${head}» ist kein Befehl eines eingeschalteten Skripts.`;
    return `«${segments[0]}» ist kein Befehl.`;
  }

  /** Reads a chain of commands joined by «;». */
  parse(text: string): Parsed {
    const split = splitChain(text);
    if (typeof split === "string") return { error: split, step: 1 };
    const parts = split.map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { error: "Leerer Befehl.", step: 1 };
    if (parts.length > limits.steps)
      return {
        error: `Mehr als ${limits.steps} Schritte gehen nicht.`,
        step: limits.steps + 1,
      };
    const steps: Step[] = [];
    for (const [i, part] of parts.entries()) {
      const step = this.parseStep(part);
      if (typeof step === "string") return { error: step, step: i + 1 };
      if (parts.length > 1 && step.spec.interactive)
        return {
          error: `«${step.text}» geht nicht in einem Makro.`,
          step: i + 1,
        };
      steps.push(step);
    }
    return { steps };
  }

  /**
   * Why a chain kept in the keymap cannot be, or undefined. A script's
   * command (`$helfer:…`) is only read as written: its script may be
   * switched off in this forest or not read yet, and it is refused with the
   * reason when it runs (ADR 0008).
   */
  check(text: string): string | undefined {
    const parts = splitChain(text);
    if (typeof parts === "string") return parts;
    const steps = parts.map((p) => p.trim()).filter(Boolean);
    if (!steps.length) return "Leerer Befehl.";
    for (const part of steps) {
      if (part.startsWith("$") && !part.startsWith(`$${gameNamespace}:`)) {
        const call = readCall(part);
        if (typeof call === "string") return call;
        continue;
      }
      const step = this.parseStep(part);
      if (typeof step === "string") return step;
      if (steps.length > 1 && step.spec.interactive)
        return `«${step.text}» geht nicht in einem Makro.`;
    }
    return undefined;
  }

  /** What a chain does, in German. */
  describe(steps: Step[]): string {
    if (steps.length === 1) return steps[0].spec.describe(steps[0].args);
    return `${steps.length} Schritte: ${steps
      .slice(0, 3)
      .map((s) => s.spec.describe(s.args))
      .join(", ")}${steps.length > 3 ? " …" : ""}`;
  }

  /**
   * Every command the finder can list now: one per command, one per choice
   * of a choice argument, and the examples of a number argument.
   */
  entries(): Entry[] {
    const out: Entry[] = [];
    const add = (spec: Spec, args: string[]) =>
      out.push({
        text: write(spec, args),
        description: spec.describe(args),
        why: spec.unavailable?.(args),
        signature: signature(spec),
      });
    for (const spec of [...this.specs, ...this.extra()]) {
      if (spec.hidden?.()) continue;
      const declared = spec.args ?? [];
      const choice = declared.find((a) => a.kind === "choice");
      if (choice?.kind === "choice") {
        for (const c of choice.choices()) if (!c.unlisted) add(spec, [c.value]);
        continue;
      }
      const number = declared[0];
      if (!number || number.kind !== "number") {
        add(spec, []);
        continue;
      }
      if (number.fallback !== undefined) add(spec, []);
      for (const example of spec.examples ?? []) add(spec, example);
    }
    return out;
  }

  // --- Running -------------------------------------------------------------------

  /**
   * Runs a chain with the count typed before it; returns whether every step
   * ran. A single command takes the count as it says; a chain runs that many
   * times.
   */
  run(steps: Step[], count = 0): boolean {
    const outermost = this.nesting === 0;
    this.nesting++;
    try {
      if (steps.length === 1) return this.step(steps[0], count);
      const times = Math.max(1, Math.min(limits.count, count));
      for (let t = 0; t < times; t++)
        for (const [i, step] of steps.entries()) {
          if (!this.step(step, 0, i + 1, steps.length)) return false;
        }
      return true;
    } finally {
      this.nesting--;
      if (outermost) this.budget = 0;
    }
  }

  /** Reads and runs a chain, saying why not if it cannot. */
  runText(text: string, count = 0): boolean {
    const parsed = this.parse(text);
    if ("error" in parsed) {
      this.announce(
        parsed.step > 1
          ? `Schritt ${parsed.step}: ${parsed.error}`
          : parsed.error,
      );
      return false;
    }
    return this.run(parsed.steps, count);
  }

  /** Runs a named macro, refusing one that runs itself. */
  runMacro(name: string, text: string, count = 0): boolean {
    if (this.running.includes(name)) {
      this.announce(`Das Makro «${name}» kann sich nicht selbst ausführen.`);
      return false;
    }
    if (this.running.length >= limits.depth) {
      this.announce("Zu viele Makros ineinander.");
      return false;
    }
    this.running.push(name);
    try {
      return this.runText(text, count);
    } finally {
      this.running.pop();
    }
  }

  private step(step: Step, count: number, at = 0, of = 0): boolean {
    const { spec } = step;
    // An empty reason: the step said why itself.
    const fail = (why: string) => {
      if (why)
        this.announce(
          at
            ? `Makro hält bei Schritt ${at} von ${of} (${step.text}): ${why}`
            : why,
        );
      return false;
    };
    let args = step.args;
    let times = 1;
    // A count stands for the first number value.
    const slot = spec.args?.findIndex((a) => a.kind === "number") ?? -1;
    const number = slot >= 0 ? spec.args?.[slot] : undefined;
    if (count && spec.count === "number" && number?.kind === "number") {
      // The count stands for the number if none was given, else multiplies it.
      const given = Number(args[slot] ?? number.fallback ?? 1);
      const n = Math.min(
        number.max,
        given === number.fallback ? count : given * count,
      );
      args = args.slice();
      args[slot] = String(n);
    } else if (count && spec.count === "repeat")
      times = Math.min(limits.count, count);
    for (let t = 0; t < times; t++) {
      if (++this.budget > limits.run)
        return fail(`Mehr als ${limits.run} Schritte auf einmal gehen nicht.`);
      // What the player does is recorded even if it fails here, as it may
      // work where the macro runs; only what was run directly, not the steps
      // inside a macro run.
      if (this.recording && !spec.interactive && this.nesting === 1)
        this.write(spec, args);
      const why = spec.unavailable?.(args);
      if (why) return fail(why);
      const failed = spec.run(args);
      if (typeof failed === "string") return fail(failed);
    }
    return true;
  }

  // --- Scripts (ADR 0007) ------------------------------------------------------------

  /**
   * A game command for a script, found by its segments as written (such as
   * `repair:under` or `build:hütte`), with its values; why not, if it is
   * none or cannot run in a script.
   */
  forScript(head: string): CommandInfo | string {
    const segments = head.split(":");
    for (let n = segments.length; n > 0; n--) {
      const spec = this.byId.get(segments.slice(0, n).join(":"));
      if (!spec) continue;
      if (spec.interactive) return `«${spec.id}» geht nicht in einem Skript.`;
      return {
        id: spec.id,
        segments: segments.slice(n),
        args: (spec.args ?? []).map((a) => ({
          kind: a.kind,
          name: a.name,
          optional: a.kind === "number" && a.fallback !== undefined,
          ...(a.kind === "number" ? { min: a.min, max: a.max } : {}),
          ...(a.kind === "choice"
            ? { choices: a.choices().map((c) => c.value) }
            : {}),
        })),
      };
    }
    return `«${segments[0]}» ist kein Befehl.`;
  }

  /** Runs one command for a script: why not, or the work it left. */
  runScript(text: string): { error?: string; work?: Work } {
    const step = this.parseStep(text);
    if (typeof step === "string") return { error: step };
    if (step.spec.interactive)
      return { error: `«${step.text}» geht nicht in einem Skript.` };
    const why = step.spec.unavailable?.(step.args);
    if (why) return { error: why };
    const result = step.spec.run(step.args);
    if (typeof result === "string")
      return { error: result || `«${step.text}» ging nicht.` };
    return result ? { work: result } : {};
  }

  // --- Recording ------------------------------------------------------------------

  startRecording() {
    this.recording = [];
    for (const listener of this.listeners) listener();
  }

  /** Ends the recording; returns its steps as a chain, empty if none. */
  stopRecording(): string {
    const steps = this.recording ?? [];
    this.recording = null;
    const text = steps.map((s) => write(s.spec, s.args)).join(";");
    if (text) this.last = text;
    for (const listener of this.listeners) listener();
    return text;
  }

  /** Writes a step down; moves in a row add up, as `up;up;up` to `up(3)`. */
  private write(spec: Spec, args: string[]) {
    const steps = this.recording;
    if (!steps) return;
    if (steps.length >= limits.steps) return;
    const previous = steps[steps.length - 1];
    if (
      spec.hold &&
      previous?.spec === spec &&
      args.length === 1 &&
      previous.args.length === 1
    ) {
      const sum = Number(previous.args[0]) + Number(args[0]);
      previous.args = [String(sum)];
      return;
    }
    steps.push({ spec, args: args.slice() });
  }
}

/**
 * A command as written: its id, its leading choices as segments where they
 * can stand there, then its other values in parentheses.
 */
export function write(spec: Spec, args: string[]): string {
  const declared = spec.args ?? [];
  const segments: string[] = [];
  const values: string[] = [];
  for (const [i, a] of args.entries()) {
    const kind = declared[i]?.kind;
    if (!values.length && kind === "choice" && segmentSafe(a)) segments.push(a);
    else if (kind === "number" || kind === "any") values.push(a);
    else values.push(JSON.stringify(a));
  }
  return (
    [spec.id, ...segments].join(":") +
    (values.length ? `(${values.join(", ")})` : "")
  );
}

/** A command's values by name, such as `up(Felder)`; none for choices only. */
function signature(spec: Spec): string | undefined {
  const args = spec.args ?? [];
  if (!args.some((a) => a.kind !== "choice")) return undefined;
  return `${spec.id}(${args.map((a) => a.name).join(", ")})`;
}

/** Fills a command's values from its segments and parentheses, checked. */
function fill(
  spec: Spec,
  segments: string[],
  values: Literal[],
): Step | string {
  const declared = spec.args ?? [];
  for (const [i, seg] of segments.entries())
    if (declared[i]?.kind !== "choice")
      return declared.length
        ? `«${spec.id}» nimmt seine Werte in Klammern: ${spec.id}(${/^\d+$/.test(seg) ? seg : JSON.stringify(seg)}).`
        : `«${spec.id}» hat keinen Teil «${seg}».`;
  const given: Literal[] = [...segments, ...values];
  if (given.length > declared.length)
    return declared.length
      ? `«${spec.id}» nimmt ${declared.length === 1 ? "einen Wert" : `${declared.length} Werte`}, nicht ${given.length}.`
      : `«${spec.id}» nimmt keine Werte.`;
  const args: string[] = [];
  for (const [i, arg] of declared.entries()) {
    const v = given[i];
    if (arg.kind === "number") {
      if (v === undefined) {
        if (arg.fallback === undefined)
          return `«${spec.id}» braucht eine Zahl (${arg.name}).`;
        args.push(String(arg.fallback));
        continue;
      }
      if (typeof v !== "number")
        return `«${spec.id}»: ${arg.name} ist eine Zahl, nicht ${JSON.stringify(v)}.`;
      if (!Number.isInteger(v)) return `«${v}» ist keine ganze Zahl.`;
      if (v < arg.min || v > arg.max)
        return `${arg.name}: ${arg.min} bis ${arg.max}.`;
      args.push(String(v));
    } else if (arg.kind === "choice") {
      if (v === undefined) return `«${spec.id}» braucht ${arg.name}.`;
      const value = String(v);
      if (!arg.choices().some((c) => c.value === value))
        return `«${value}» gibt es bei «${spec.id}» nicht.`;
      args.push(value);
    } else if (arg.kind === "text") {
      if (v === undefined)
        return `«${spec.id}» braucht einen Text (${arg.name}), wie ${spec.id}("Hallo").`;
      const value = String(v);
      if (value.length > (arg.max ?? 500))
        return `${arg.name}: höchstens ${arg.max ?? 500} Zeichen.`;
      args.push(value);
    } else {
      if (v === undefined) return `«${spec.id}» braucht ${arg.name}.`;
      args.push(JSON.stringify(v));
    }
  }
  return { spec, args, text: write(spec, args) };
}
