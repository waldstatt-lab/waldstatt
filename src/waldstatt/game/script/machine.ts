/**
 * The machine that runs compiled scripts (ADR 0007). A run's whole state is
 * plain data, so it can be saved with the forest and continue after a
 * reload: a stack of frames (the body, where in it, its variables and its
 * values), what it waits for, its timeouts and its deadline, all in seconds
 * of play. A run starts at the script's top, or at one of its `cmd:` with
 * values (ADR 0008). The machine reaches the game only through its host:
 * commands as text, written as the finder reads them (`repair:under(5)`),
 * the game's queries by name, the fields of buildings, and whether a
 * command's work is done. It runs a limited number of steps at a time, so
 * no script can freeze the page.
 */
import type { Fn, Ins, Program, Value } from "./compile";

/** What a command left to wait for, as the game describes it: plain data. */
export interface Work {
  kind: string;
  ids: number[];
}

/** What the machine needs from the game. */
export interface MachineHost {
  /** Seconds of play. */
  now(): number;
  /** Runs a game command as written; why not, or the work it left. */
  command(text: string): { error?: string; work?: Work };
  /** Runs a game query; its value, or why not. */
  query(name: string, args: Value[]): Value | { error: string };
  /** A field of a building; none if it is gone. */
  field(building: number, name: string): Value | { error: string };
  /** How a building reads in a text, such as «Hütte (12, 4)». */
  describe(building: number): string;
  /** Whether a command's work is done: true, false, or why it never will be. */
  done(work: Work): boolean | string;
  say(text: string): void;
}

export interface Frame {
  fn: string;
  pc: number;
  vars: Record<string, Value>;
  stack: Value[];
}

export interface RunState {
  /** The program it runs, by its hash; the script, for the dialog. */
  program: string;
  script: string;
  /** The `cmd:` it started at, by its key `script:name`; none for the top. */
  entry?: string;
  frames: Frame[];
  /** Waiting until a point of the clock, or for a command's work. */
  wait?: { until?: number; work?: Work };
  /** Timeouts open: when they end, where to go on, and in which frame. */
  timeouts: { deadline: number; target: number; depth: number }[];
  /** When the whole run must have ended, in seconds of play. */
  deadline: number;
}

export type Status =
  | { state: "running" | "waiting" | "done" }
  | { state: "failed"; error: string; line: number; script: string };

const limits = {
  frames: 64,
  stack: 256,
  list: 1000,
  text: 10_000,
};

/** How long `wait until` waits between looks, in seconds of play. */
const tick = 0.25;

/** A new run of a program, starting now. */
export function start(program: Program, now: number): RunState {
  return {
    program: program.hash,
    script: program.name,
    frames: [{ fn: "main", pc: 0, vars: {}, stack: [] }],
    timeouts: [],
    deadline: now + program.timeout,
  };
}

/** A new run of one of a program's `cmd:`, with its values, starting now. */
export function startAt(
  program: Program,
  key: string,
  values: Value[],
  now: number,
): RunState | string {
  const fn = program.fns[key];
  if (!fn || fn.kind !== "cmd") return `Den Befehl «${key}» gibt es nicht.`;
  if (fn.params.length !== values.length)
    return `«${key.slice(key.indexOf(":") + 1)}» braucht ${fn.params.length} ${fn.params.length === 1 ? "Wert" : "Werte"}.`;
  const vars: Record<string, Value> = {};
  fn.params.forEach((p, i) => (vars[p] = values[i]));
  return {
    program: program.hash,
    script: program.name,
    entry: key,
    frames: [{ fn: key, pc: 0, vars, stack: [] }],
    timeouts: [],
    deadline: now + program.timeout,
  };
}

/** A value as a command takes it: a number as it is, a text in quotes. */
function commandValue(v: Value, host: MachineHost): string | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object" && v !== null && !Array.isArray(v) && "b" in v)
    return JSON.stringify(host.describe(v.b));
  return undefined;
}

class Fail extends Error {}

const isBuilding = (v: Value): v is { b: number } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "b" in v;
const isRecord = (v: Value): v is { r: Record<string, Value> } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "r" in v;

/** Whether a value counts as yes: not false, none, 0, "" or []. */
export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== false && v !== null && v !== 0 && v !== "";
}

function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isBuilding(a) && isBuilding(b)) return a.b === b.b;
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a.r);
    return (
      ka.length === Object.keys(b.r).length &&
      ka.every((k) => equal(a.r[k], b.r[k]))
    );
  }
  return a === b;
}

/** A value as a text, for `say`, `{…}` and commands. */
export function text(v: Value, host?: MachineHost): string {
  if (v === null) return "none";
  if (typeof v === "number")
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => text(x, host)).join(", ")}]`;
  if (isBuilding(v)) return host ? host.describe(v.b) : `#${v.b}`;
  return `{${Object.entries(v.r)
    .map(([k, x]) => `${k}: ${text(x, host)}`)
    .join(", ")}}`;
}

/**
 * Runs up to `budget` steps of a run; returns how it stands and how many
 * steps it took. A run waiting takes one step to look.
 */
export function step(
  run: RunState,
  programs: (hash: string) => Program | undefined,
  host: MachineHost,
  budget: number,
): { status: Status; steps: number } {
  const program = programs(run.program);
  if (!program)
    return {
      status: {
        state: "failed",
        error: "Das Programm fehlt.",
        line: 0,
        script: run.script,
      },
      steps: 1,
    };
  let steps = 0;
  let fn: Fn = program.fns[run.frames[run.frames.length - 1].fn];
  let frame = run.frames[run.frames.length - 1];
  const enter = () => {
    frame = run.frames[run.frames.length - 1];
    fn = program.fns[frame.fn];
  };
  const fail = (error: string): never => {
    throw new Fail(error);
  };
  const pop = (): Value => {
    if (!frame.stack.length) fail("Der Stapel ist leer.");
    return frame.stack.pop() as Value;
  };
  const push = (v: Value) => {
    if (frame.stack.length >= limits.stack) fail("Zu viele Werte auf einmal.");
    frame.stack.push(v);
  };
  const num = (v: Value, what: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v))
      fail(`${what} braucht eine Zahl, nicht «${text(v, host)}».`);
    return v as number;
  };
  const returnFrom = (value: Value | undefined) => {
    run.frames.pop();
    // Timeouts opened in that frame end with it.
    run.timeouts = run.timeouts.filter((t) => t.depth <= run.frames.length);
    if (!run.frames.length) return;
    enter();
    if (value !== undefined) push(value);
  };
  const line = () => fn.lines[Math.max(0, frame.pc - 1)] ?? 0;

  try {
    while (steps < budget) {
      steps++;
      // The command a run started at has returned.
      if (!run.frames.length) return { status: { state: "done" }, steps };
      const now = host.now();
      // The whole run's deadline, then timeouts: the outermost one that is
      // up wins, and those opened inside it end with it.
      if (now >= run.deadline)
        fail("Die Zeit für das Skript ist um (timeout).");
      const up = run.timeouts.findIndex((t) => now >= t.deadline);
      if (up >= 0) {
        const open = run.timeouts[up];
        run.timeouts.length = up;
        run.wait = undefined;
        while (run.frames.length > open.depth) run.frames.pop();
        enter();
        // A timeout opens and closes between statements, where no values wait.
        frame.stack = [];
        frame.pc = open.target;
        continue;
      }
      if (run.wait) {
        const w = run.wait;
        if (w.until !== undefined && now < w.until)
          return { status: { state: "waiting" }, steps };
        if (w.work) {
          const done = host.done(w.work);
          if (typeof done === "string") fail(done);
          if (!done) return { status: { state: "waiting" }, steps };
        }
        run.wait = undefined;
      }
      if (frame.pc >= fn.code.length) {
        // The end of a body: the script ends, a command or query returns.
        if (frame.fn === "main") {
          run.frames = [];
          return { status: { state: "done" }, steps };
        }
        returnFrom(fn.kind === "qry" ? null : undefined);
        continue;
      }
      const ins = fn.code[frame.pc++] as Ins;
      switch (ins[0]) {
        case "const":
          push(ins[1]);
          break;
        case "load": {
          if (!Object.hasOwn(frame.vars, ins[1])) {
            const v = host.query(ins[1], []);
            if (v !== null && typeof v === "object" && "error" in v)
              fail(v.error as string);
            push(v as Value);
          } else push(frame.vars[ins[1]]);
          break;
        }
        case "store":
          frame.vars[ins[1]] = pop();
          break;
        case "field": {
          const v = pop();
          if (v === null) push(null);
          else if (isBuilding(v)) {
            const f = host.field(v.b, ins[1]);
            if (f !== null && typeof f === "object" && "error" in f)
              fail(f.error as string);
            push(f as Value);
          } else if (isRecord(v)) {
            if (!Object.hasOwn(v.r, ins[1]))
              fail(
                `«${ins[1]}» gibt es da nicht; es gibt ${Object.keys(v.r).join(", ")}.`,
              );
            push(v.r[ins[1]]);
          } else if (Array.isArray(v) && ins[1] === "length") push(v.length);
          else fail(`«${text(v, host)}» hat kein Feld «${ins[1]}».`);
          break;
        }
        case "index": {
          const i = num(pop(), "Ein Index");
          const v = pop();
          if (Array.isArray(v)) push(v[Math.floor(i)] ?? null);
          else if (typeof v === "string") push(v[Math.floor(i)] ?? null);
          else fail(`«${text(v, host)}» ist keine Liste.`);
          break;
        }
        case "list": {
          const items = frame.stack.splice(frame.stack.length - ins[1], ins[1]);
          push(items);
          break;
        }
        case "concat": {
          const parts = frame.stack.splice(frame.stack.length - ins[1], ins[1]);
          const s = parts.map((p) => text(p, host)).join("");
          if (s.length > limits.text) fail("Der Text ist zu lang.");
          push(s);
          break;
        }
        case "callq": {
          const args = frame.stack.splice(frame.stack.length - ins[2], ins[2]);
          const own = program.fns[ins[1]];
          if (own?.kind === "qry") {
            if (run.frames.length >= limits.frames)
              fail("Zu viele Aufrufe ineinander.");
            const vars: Record<string, Value> = {};
            own.params.forEach((p, i) => (vars[p] = args[i] ?? null));
            run.frames.push({ fn: ins[1], pc: 0, vars, stack: [] });
            enter();
          } else {
            const v = host.query(ins[1], args);
            if (v !== null && typeof v === "object" && "error" in v)
              fail(v.error as string);
            push(v as Value);
          }
          break;
        }
        case "callc": {
          const args = frame.stack.splice(frame.stack.length - ins[2], ins[2]);
          const own = program.fns[ins[1]];
          if (!own) fail(`Den Befehl «${ins[1]}» gibt es nicht.`);
          if (run.frames.length >= limits.frames)
            fail("Zu viele Aufrufe ineinander.");
          const vars: Record<string, Value> = {};
          own.params.forEach((p, i) => (vars[p] = args[i] ?? null));
          run.frames.push({ fn: ins[1], pc: 0, vars, stack: [] });
          enter();
          break;
        }
        case "bin": {
          const b = pop();
          const a = pop();
          const op = ins[1];
          if (op === "==") push(equal(a, b));
          else if (op === "!=") push(!equal(a, b));
          else if (
            op === "+" &&
            (typeof a === "string" || typeof b === "string")
          ) {
            const s = text(a, host) + text(b, host);
            if (s.length > limits.text) fail("Der Text ist zu lang.");
            push(s);
          } else if (op === "+" && Array.isArray(a) && Array.isArray(b)) {
            if (a.length + b.length > limits.list)
              fail("Die Liste ist zu lang.");
            push([...a, ...b]);
          } else {
            const x = num(a, `«${op}»`);
            const y = num(b, `«${op}»`);
            switch (op) {
              case "+":
                push(x + y);
                break;
              case "-":
                push(x - y);
                break;
              case "*":
                push(x * y);
                break;
              case "/":
                if (y === 0) fail("Durch null teilen geht nicht.");
                push(x / y);
                break;
              case "%":
                if (y === 0) fail("Durch null teilen geht nicht.");
                push(x % y);
                break;
              case "<":
                push(x < y);
                break;
              case "<=":
                push(x <= y);
                break;
              case ">":
                push(x > y);
                break;
              case ">=":
                push(x >= y);
                break;
              default:
                fail(`«${op}» geht hier nicht.`);
            }
          }
          break;
        }
        case "not":
          push(!truthy(pop()));
          break;
        case "neg":
          push(-num(pop(), "Das Minus"));
          break;
        case "jump":
          frame.pc = ins[1];
          break;
        case "jf":
          if (!truthy(pop())) frame.pc = ins[1];
          break;
        case "iter": {
          const [, listVar, indexVar, name, out] = ins;
          const list = frame.vars[listVar];
          const index = frame.vars[indexVar] as number;
          if (!Array.isArray(list))
            fail(`«${text(list, host)}» ist keine Liste.`);
          if (index >= (list as Value[]).length) frame.pc = out;
          else {
            frame.vars[name] = (list as Value[])[index];
            frame.vars[indexVar] = index + 1;
          }
          break;
        }
        case "cmd": {
          const [, id, segments, count, awaits] = ins;
          const values = frame.stack.splice(frame.stack.length - count, count);
          const written: string[] = [];
          for (const v of values) {
            const w = commandValue(v, host);
            if (w === undefined)
              fail(`«${id}» nimmt Zahlen und Texte, nicht «${text(v, host)}».`);
            written.push(w as string);
          }
          const result = host.command(
            [id, ...segments].join(":") +
              (written.length ? `(${written.join(", ")})` : ""),
          );
          if (result.error) fail(result.error);
          if (awaits && result.work) {
            run.wait = { work: result.work };
            return { status: { state: "waiting" }, steps };
          }
          break;
        }
        case "wait": {
          const seconds = num(pop(), "«wait»");
          if (seconds > 0) {
            run.wait = { until: now + seconds };
            return { status: { state: "waiting" }, steps };
          }
          break;
        }
        case "tick":
          run.wait = { until: now + tick };
          return { status: { state: "waiting" }, steps };
        case "say":
          host.say(text(pop(), host));
          break;
        case "ret":
          returnFrom(undefined);
          break;
        case "retv":
          returnFrom(pop());
          break;
        case "stop":
          run.frames = [];
          return { status: { state: "done" }, steps };
        case "tpush": {
          const seconds = num(pop(), "«timeout»");
          run.timeouts.push({
            deadline: now + seconds,
            target: ins[1],
            depth: run.frames.length,
          });
          break;
        }
        case "tpop":
          run.timeouts.pop();
          break;
      }
    }
    return { status: { state: "running" }, steps };
  } catch (error) {
    if (!(error instanceof Fail)) throw error;
    return {
      status: {
        state: "failed",
        error: error.message,
        line: line(),
        script: fn.script,
      },
      steps,
    };
  }
}

// --- Checking a run read back -------------------------------------------------------

/** Whether a value read back is one a program can hold, within limits. */
export function validValue(v: unknown, depth = 0): v is Value {
  if (depth > 8) return false;
  if (v === null || typeof v === "boolean" || typeof v === "string")
    return typeof v !== "string" || v.length <= limits.text;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v))
    return v.length <= limits.list && v.every((x) => validValue(x, depth + 1));
  if (typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1) return false;
  if (keys[0] === "b") return Number.isInteger(o.b);
  if (
    keys[0] === "r" &&
    typeof o.r === "object" &&
    o.r !== null &&
    !Array.isArray(o.r)
  )
    return Object.values(o.r).every((x) => validValue(x, depth + 1));
  return false;
}

/** Checks a run read back against its program; the run, or undefined. */
export function validRun(raw: unknown, program: Program): RunState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.program !== program.hash || r.script !== program.name) return undefined;
  if (
    !Array.isArray(r.frames) ||
    !r.frames.length ||
    r.frames.length > limits.frames
  )
    return undefined;
  const frames: Frame[] = [];
  for (const f of r.frames as unknown[]) {
    if (typeof f !== "object" || f === null) return undefined;
    const fr = f as Record<string, unknown>;
    const fn =
      typeof fr.fn === "string" && Object.hasOwn(program.fns, fr.fn)
        ? program.fns[fr.fn]
        : undefined;
    if (
      !fn ||
      !Number.isInteger(fr.pc) ||
      (fr.pc as number) < 0 ||
      (fr.pc as number) > fn.code.length
    )
      return undefined;
    if (
      typeof fr.vars !== "object" ||
      fr.vars === null ||
      Array.isArray(fr.vars)
    )
      return undefined;
    const vars: Record<string, Value> = {};
    for (const [k, v] of Object.entries(fr.vars)) {
      if (!validValue(v)) return undefined;
      vars[k] = v;
    }
    if (
      !Array.isArray(fr.stack) ||
      fr.stack.length > limits.stack ||
      !fr.stack.every((v) => validValue(v))
    )
      return undefined;
    frames.push({
      fn: fr.fn as string,
      pc: fr.pc as number,
      vars,
      stack: fr.stack as Value[],
    });
  }
  const entry =
    typeof r.entry === "string" &&
    Object.hasOwn(program.fns, r.entry) &&
    program.fns[r.entry].kind === "cmd"
      ? r.entry
      : undefined;
  if (r.entry !== undefined && !entry) return undefined;
  if (frames[0].fn !== (entry ?? "main")) return undefined;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  let wait: RunState["wait"];
  if (r.wait !== undefined) {
    const w = r.wait as Record<string, unknown>;
    if (typeof w !== "object" || w === null) return undefined;
    wait = {};
    if (w.until !== undefined) {
      if (!num(w.until)) return undefined;
      wait.until = w.until as number;
    }
    if (w.work !== undefined) {
      const work = w.work as Record<string, unknown>;
      if (
        typeof work !== "object" ||
        work === null ||
        typeof work.kind !== "string" ||
        !Array.isArray(work.ids) ||
        work.ids.length > 1000 ||
        !work.ids.every((i) => Number.isInteger(i))
      )
        return undefined;
      wait.work = { kind: work.kind, ids: work.ids as number[] };
    }
  }
  if (!Array.isArray(r.timeouts) || r.timeouts.length > 64) return undefined;
  const timeouts: RunState["timeouts"] = [];
  for (const t of r.timeouts as unknown[]) {
    const o = t as Record<string, unknown>;
    if (
      typeof o !== "object" ||
      o === null ||
      !num(o.deadline) ||
      !Number.isInteger(o.target) ||
      !Number.isInteger(o.depth)
    )
      return undefined;
    // In a frame of the run, inside those before it, and jumping into its code.
    const depth = o.depth as number;
    const target = o.target as number;
    if (
      depth < 1 ||
      depth > frames.length ||
      depth < (timeouts[timeouts.length - 1]?.depth ?? 1) ||
      target < 0 ||
      target > program.fns[frames[depth - 1].fn].code.length
    )
      return undefined;
    timeouts.push({
      deadline: o.deadline as number,
      target: o.target as number,
      depth: o.depth as number,
    });
  }
  if (!num(r.deadline)) return undefined;
  return {
    program: program.hash,
    script: program.name,
    ...(entry ? { entry } : {}),
    frames,
    wait,
    timeouts,
    deadline: r.deadline as number,
  };
}
