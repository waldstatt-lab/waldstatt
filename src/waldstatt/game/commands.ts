/**
 * The commands (ADR 0006): everything the keyboard and the «:» finder can do,
 * by name. A command's id is a path of colon segments, its fixed part and
 * then its arguments: `up`, `up:20`, `build:hütte`, `repair:under:5`.
 * Namespaces and verbs are English identifiers; names of things are as the
 * game names them, as lower-case slugs. Each command describes itself in
 * German, says why it cannot run now, and says how a count typed before its
 * key combines with it. A macro is a chain of commands joined by «;», run in
 * order and stopped at the first step that cannot run; a count repeats the
 * whole chain. While recording, every command run is written down, so it can
 * be replayed or kept as a named macro. Keys bind to commands (keymap.ts);
 * the dispatcher runs them (dispatch.ts).
 */

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
  | { kind: "choice"; name: string; choices(): Choice[] };

export interface Spec {
  /** The fixed segments, such as `repair:under`. */
  id: string;
  args?: Arg[];
  /** What it does with these arguments, in German. */
  describe(args: string[]): string;
  /** Why it cannot run now, in German; undefined if it can. */
  unavailable?(args: string[]): string | undefined;
  /** Runs it; returns why it failed, in German, if it did. */
  run(args: string[]): string | void;
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
  /** Arguments the finder offers as examples, such as `repair:under:10`. */
  examples?: string[][];
}

/** A command with its arguments, ready to run. */
export interface Step {
  spec: Spec;
  args: string[];
  /** As it is written, such as `up:20`. */
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
}

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
  private recording: string[] | null = null;
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

  /** Calls back when a recording starts or ends. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  // --- Reading commands --------------------------------------------------------

  /** Reads one command, such as `repair:under:5`, or why it is not one. */
  parseStep(text: string): Step | string {
    const segments = text.trim().split(":");
    if (!text.trim()) return "Leerer Befehl.";
    for (let n = segments.length; n > 0; n--) {
      const spec = this.byId.get(segments.slice(0, n).join(":"));
      if (!spec) continue;
      const given = segments.slice(n);
      const args: string[] = [];
      const declared = spec.args ?? [];
      if (given.length > declared.length)
        return `«${text.trim()}» hat zu viele Teile.`;
      for (const [i, arg] of declared.entries()) {
        const value = given[i];
        if (arg.kind === "number") {
          if (value === undefined || value === "") {
            if (arg.fallback === undefined)
              return `«${spec.id}» braucht eine Zahl (${arg.name}).`;
            args.push(String(arg.fallback));
            continue;
          }
          if (!/^\d{1,4}$/.test(value)) return `«${value}» ist keine Zahl.`;
          const n = Number(value);
          if (n < arg.min || n > arg.max)
            return `${arg.name}: ${arg.min} bis ${arg.max}.`;
          args.push(String(n));
        } else {
          if (value === undefined || value === "")
            return `«${spec.id}» braucht ${arg.name}.`;
          if (!arg.choices().some((c) => c.value === value))
            return `«${value}» gibt es bei «${spec.id}» nicht.`;
          args.push(value);
        }
      }
      return { spec, args, text: write(spec, args) };
    }
    return `«${segments[0]}» ist kein Befehl.`;
  }

  /** Reads a chain of commands joined by «;». */
  parse(text: string): Parsed {
    const parts = text
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
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
      });
    for (const spec of this.specs) {
      const declared = spec.args ?? [];
      const choice = declared.find((a) => a.kind === "choice");
      if (choice?.kind === "choice") {
        for (const c of choice.choices()) add(spec, [c.value]);
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
    const number = spec.args?.[0];
    if (count && spec.count === "number" && number?.kind === "number") {
      // The count stands for the number if none was given, else multiplies it.
      const given = Number(args[0] ?? number.fallback ?? 1);
      const n = Math.min(
        number.max,
        given === number.fallback ? count : given * count,
      );
      args = [String(n), ...args.slice(1)];
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

  // --- Recording ------------------------------------------------------------------

  startRecording() {
    this.recording = [];
    for (const listener of this.listeners) listener();
  }

  /** Ends the recording; returns its steps as a chain, empty if none. */
  stopRecording(): string {
    const steps = this.recording ?? [];
    this.recording = null;
    const text = steps.join(";");
    if (text) this.last = text;
    for (const listener of this.listeners) listener();
    return text;
  }

  /** Writes a step down; moves in a row add up, as `up;up;up` to `up:3`. */
  private write(spec: Spec, args: string[]) {
    const steps = this.recording;
    if (!steps) return;
    if (steps.length >= limits.steps) return;
    const previous = steps[steps.length - 1];
    if (spec.hold && previous !== undefined) {
      const [id, n] = previous.split(":");
      if (id === spec.id && args.length === 1) {
        const sum = Number(n ?? 1) + Number(args[0]);
        steps[steps.length - 1] = `${spec.id}:${sum}`;
        return;
      }
    }
    steps.push(write(spec, args));
  }
}

/** A command as written: its id, then its arguments. */
function write(spec: Spec, args: string[]): string {
  return [spec.id, ...args].join(":");
}
