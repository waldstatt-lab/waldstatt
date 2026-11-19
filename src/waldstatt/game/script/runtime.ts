/**
 * Runs the player's scripts (ADR 0007): starts them by name, again and again
 * for those with `every`, steps every run a share of a budget each frame, and
 * keeps their state as plain data with the forest. Each run carries its own
 * program, compiled from the sources when it began, so editing a script does
 * not touch a run under way: it goes on as «ältere Fassung», and the next
 * start runs the new version. Runs read back are compiled again from their
 * own sources and checked against them; one that does not fit is dropped.
 * At most eight run at once, each script once. The scripts are the
 * visitor's, kept apart from the forest; each forest switches on those that
 * may run in it, and nothing runs until scripts are unlocked. A run may also
 * start at one of a script's `cmd:` with values, as `$helfer:bauen:dorf(3)`
 * does from the finder or a key (ADR 0008); it is known by that command and
 * runs once at a time too.
 */
import { ScriptError } from "./ast";
import { check, type Library } from "./check";
import { compile, machineVersion, type Program } from "./compile";
import {
  start,
  startAt,
  step,
  validRun,
  type MachineHost,
  type RunState,
} from "./machine";
import type { Value } from "./compile";

export interface RuntimeHost extends MachineHost {
  library: Library;
  /** A script's source by name, as saved now. */
  source(name: string): string | undefined;
  /** The names of the scripts saved now. */
  names(): string[];
  announce(text: string): void;
  /** Whether scripts are unlocked at all (with «niklaus:wirth»). */
  unlocked(): boolean;
  /** Shows that a script stopped with an error; else it is announced. */
  alert?(script: string, text: string): void;
}

/** What a run is known by: its script, or `$script:command` it started at. */
export const runKey = (r: RunState) => (r.entry ? `$${r.entry}` : r.script);

/** How a script stands, for the dialog. */
export type ScriptState =
  | { state: "idle" | "running" | "waiting" | "older" }
  | { state: "failed"; error: string; line: number; script: string };

/** The runtime's state, as saved with the forest. */
export interface SavedScripts {
  version: number;
  programs: Record<string, { name: string; sources: Record<string, string> }>;
  runs: RunState[];
  /** When each `every` script starts next, in seconds of play. */
  due: Record<string, number>;
  /** The scripts switched on in this forest. */
  enabled?: string[];
}

const limits = {
  runs: 8,
  /** Scripts switched on, as many as there can be. */
  enabled: 100,
  /** Steps of all runs per frame, and of one run per frame. */
  frame: 2000,
  run: 400,
};

/** A script's error as a text, naming the line and an imported script. */
export function describeError(
  e: { error: string; line: number; script: string },
  main: string,
) {
  const where =
    e.script && e.script !== main
      ? `«${e.script}», Zeile ${e.line}`
      : `Zeile ${e.line}`;
  return `${where}: ${e.error}`;
}

export class Runtime {
  readonly runs: RunState[] = [];
  private programs = new Map<string, Program>();
  private due = new Map<string, number>();
  private on = new Set<string>();
  /** The last error of each script, until it starts again. */
  private errors = new Map<string, Extract<ScriptState, { state: "failed" }>>();
  /** Compiled current versions, by source text, so a check runs once. */
  private compiled = new Map<string, Program | ScriptError>();
  private turn = 0;
  private listeners = new Set<() => void>();
  /** The script whose run is stepping now, for what it says and shows. */
  stepping: string | undefined;

  constructor(private host: RuntimeHost) {}

  /** Calls back when a run starts, ends or fails. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  /**
   * The current version of a script, compiled, or why it does not compile;
   * imports are part of it.
   */
  current(name: string): Program | ScriptError {
    const text = this.host.source(name);
    if (text === undefined)
      return new ScriptError(`Das Skript «${name}» gibt es nicht.`, {
        line: 1,
        col: 1,
      });
    // The key holds every script it may import, so a change there counts.
    const key = `${name}\u0000${this.host
      .names()
      .map((n) => `${n}\u0001${this.host.source(n)}`)
      .join("\u0002")}`;
    let result = this.compiled.get(key);
    if (!result) {
      try {
        result = compile(
          check(name, (n) => this.host.source(n), this.host.library),
        );
      } catch (error) {
        if (!(error instanceof ScriptError)) throw error;
        result = error;
      }
      if (this.compiled.size > 200) this.compiled.clear();
      this.compiled.set(key, result);
    }
    return result;
  }

  /** Whether a script is switched on in this forest. */
  enabled(name: string): boolean {
    return this.on.has(name);
  }

  /** Switches a script on or off in this forest; off stops its run. */
  enable(name: string, on: boolean) {
    if (on) {
      if (this.on.size >= limits.enabled) return;
      this.on.add(name);
    } else {
      this.on.delete(name);
      this.due.delete(name);
      const i = this.runs.findIndex((r) => r.script === name);
      if (i >= 0) this.runs.splice(i, 1);
    }
    this.changed();
  }

  /** Switches every script off in this forest; how many were on. */
  disableAll(): number {
    const n = this.on.size;
    this.on.clear();
    this.due.clear();
    this.runs.length = 0;
    if (n) this.changed();
    return n;
  }

  /** Starts a script by name; returns why not, if not. */
  start(name: string): string | undefined {
    if (!this.host.unlocked()) return "Skripte sind nicht freigeschaltet.";
    if (!this.on.has(name))
      return `«${name}» ist in diesem Wald nicht eingeschaltet.`;
    if (this.runs.some((r) => r.script === name && !r.entry))
      return `«${name}» läuft schon.`;
    if (this.runs.length >= limits.runs)
      return `Mehr als ${limits.runs} Skripte gleichzeitig gehen nicht.`;
    const program = this.current(name);
    if (program instanceof ScriptError)
      return `«${name}», ${program.script ? `«${program.script}», ` : ""}Zeile ${program.at.line}: ${program.message}`;
    this.programs.set(program.hash, program);
    this.errors.delete(name);
    this.runs.push(start(program, this.host.now()));
    this.changed();
    return undefined;
  }

  /**
   * Starts one of a script's `cmd:` with values, as `$script:name(…)` from
   * the finder or a key; returns why not, if not.
   */
  startAt(script: string, name: string, values: Value[]): string | undefined {
    if (!this.host.unlocked()) return "Skripte sind nicht freigeschaltet.";
    if (!this.on.has(script))
      return `«${script}» ist in diesem Wald nicht eingeschaltet.`;
    const key = `${script}:${name}`;
    if (this.runs.some((r) => r.entry === key)) return `«$${key}» läuft schon.`;
    if (this.runs.length >= limits.runs)
      return `Mehr als ${limits.runs} Skripte gleichzeitig gehen nicht.`;
    const program = this.current(script);
    if (program instanceof ScriptError)
      return `«${script}», ${program.script ? `«${program.script}», ` : ""}Zeile ${program.at.line}: ${program.message}`;
    const run = startAt(program, key, values, this.host.now());
    if (typeof run === "string") return run;
    this.programs.set(program.hash, program);
    this.errors.delete(script);
    this.runs.push(run);
    this.changed();
    return undefined;
  }

  /** Stops every run of a script, started at its top or at a command. */
  stop(name: string): boolean {
    const before = this.runs.length;
    for (let i = this.runs.length - 1; i >= 0; i--)
      if (this.runs[i].script === name) this.runs.splice(i, 1);
    if (this.runs.length === before) return false;
    this.changed();
    return true;
  }

  stopAll(): number {
    const n = this.runs.length;
    this.runs.length = 0;
    if (n) this.changed();
    return n;
  }

  /** How a script stands now. */
  state(name: string): ScriptState {
    const run = this.runs.find((r) => r.script === name);
    if (!run) return this.errors.get(name) ?? { state: "idle" };
    const current = this.current(name);
    if (!(current instanceof ScriptError) && current.hash !== run.program)
      return { state: "older" };
    return { state: run.wait ? "waiting" : "running" };
  }

  /** When an `every` script starts next, in seconds of play, if it is armed. */
  next(name: string): number | undefined {
    return this.due.get(name);
  }

  /**
   * One frame: starts `every` scripts that are due, and steps the runs, each
   * a share of the budget, taking turns.
   */
  tick() {
    if (!this.host.unlocked()) return;
    const now = this.host.now();
    for (const name of this.host.names()) {
      const p = this.on.has(name) ? this.current(name) : undefined;
      if (!p || p instanceof ScriptError || !p.every) {
        this.due.delete(name);
        continue;
      }
      // Armed for the first time, it starts at once.
      const due = this.due.get(name) ?? now;
      if (due <= now) {
        this.due.set(name, now + p.every);
        // A script still running from before is not started twice.
        if (!this.runs.some((r) => r.script === name)) {
          const why = this.start(name);
          if (why && !why.endsWith("läuft schon.")) this.host.announce(why);
        }
      }
    }
    for (const name of [...this.due.keys()])
      if (!this.host.names().includes(name)) this.due.delete(name);

    let budget = limits.frame;
    const n = this.runs.length;
    let ended = false;
    for (let k = 0; k < n && budget > 0; k++) {
      const run = this.runs[(this.turn + k) % n];
      if (!run) continue;
      this.stepping = run.script;
      let result: ReturnType<typeof step>;
      try {
        result = step(
          run,
          (h) => this.programs.get(h),
          this.host,
          Math.min(budget, limits.run),
        );
      } finally {
        this.stepping = undefined;
      }
      const { status, steps } = result;
      budget -= steps;
      if (status.state === "done" || status.state === "failed") {
        run.frames = [];
        ended = true;
        if (status.state === "failed") {
          this.errors.set(run.script, status);
          const why = `hält an, ${describeError(status, run.script)}`;
          if (this.host.alert) this.host.alert(run.script, why);
          else this.host.announce(`Skript «${run.script}» ${why}`);
        }
      }
    }
    this.turn = n ? (this.turn + 1) % n : 0;
    if (ended) {
      for (let i = this.runs.length - 1; i >= 0; i--)
        if (!this.runs[i].frames.length) this.runs.splice(i, 1);
      this.dropPrograms();
      this.changed();
    }
  }

  private dropPrograms() {
    const used = new Set(this.runs.map((r) => r.program));
    for (const h of [...this.programs.keys()])
      if (!used.has(h)) this.programs.delete(h);
  }

  /** The runs and their programs as plain data, to save with the forest. */
  save(): SavedScripts {
    this.dropPrograms();
    const programs: SavedScripts["programs"] = {};
    for (const [h, p] of this.programs)
      programs[h] = { name: p.name, sources: p.sources };
    return {
      version: machineVersion,
      programs,
      runs: this.runs.map((r) => structuredClone(r)),
      due: Object.fromEntries(this.due),
      enabled: [...this.on].sort(),
    };
  }

  /**
   * Takes back runs saved with the forest: each program compiled again from
   * its own sources must give the same hash, and each run must fit it.
   * Returns how many runs were dropped.
   */
  load(raw: unknown): number {
    this.runs.length = 0;
    this.programs.clear();
    this.due.clear();
    this.on.clear();
    if (typeof raw !== "object" || raw === null) return 0;
    const r = raw as Record<string, unknown>;
    // Saved before forests switched scripts on: those that ran or were due.
    const enabled = Array.isArray(r.enabled)
      ? r.enabled
      : [
          ...(Array.isArray(r.runs)
            ? r.runs.map((run) => (run as { script?: unknown })?.script)
            : []),
          ...(typeof r.due === "object" && r.due !== null
            ? Object.keys(r.due)
            : []),
        ];
    for (const name of enabled.slice(0, limits.enabled))
      if (typeof name === "string" && name.length <= 60) this.on.add(name);
    const runs = Array.isArray(r.runs) ? r.runs.slice(0, limits.runs) : [];
    if (typeof r.due === "object" && r.due !== null)
      for (const [name, at] of Object.entries(r.due))
        if (typeof at === "number" && Number.isFinite(at))
          this.due.set(name, at);
    if (r.version !== machineVersion) return runs.length;
    const programs = (
      typeof r.programs === "object" && r.programs !== null ? r.programs : {}
    ) as Record<string, unknown>;
    let dropped = 0;
    for (const raw of runs) {
      const h = (raw as { program?: unknown })?.program;
      const saved = typeof h === "string" ? programs[h] : undefined;
      const program =
        typeof h === "string"
          ? (this.programs.get(h) ?? this.recompile(h, saved))
          : undefined;
      const run = program && validRun(raw, program);
      // A run of a script switched off goes with it.
      if (run && !this.on.has(run.script)) continue;
      if (!program || !run) {
        dropped++;
        continue;
      }
      this.programs.set(program.hash, program);
      this.runs.push(run);
    }
    this.changed();
    return dropped;
  }

  private recompile(hash: string, saved: unknown): Program | undefined {
    if (typeof saved !== "object" || saved === null) return undefined;
    const s = saved as { name?: unknown; sources?: unknown };
    if (
      typeof s.name !== "string" ||
      typeof s.sources !== "object" ||
      s.sources === null
    )
      return undefined;
    const sources = s.sources as Record<string, unknown>;
    if (Object.keys(sources).length > 16) return undefined;
    for (const v of Object.values(sources))
      if (typeof v !== "string" || v.length > 50_000) return undefined;
    try {
      const p = compile(
        check(
          s.name,
          (n) => sources[n] as string | undefined,
          this.host.library,
        ),
      );
      return p.hash === hash ? p : undefined;
    } catch {
      return undefined;
    }
  }
}
