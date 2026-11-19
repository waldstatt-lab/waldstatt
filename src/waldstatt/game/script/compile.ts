/**
 * Compiles a checked script (check.ts) into a program for the machine
 * (machine.ts): one list of simple instructions per body, the script's own
 * (`main`) and each `cmd:` and `qry:` of the scripts it uses (by the key
 * `script:name`), with the line of each instruction for errors. A game
 * command is written out with its values when it runs, as the finder reads
 * it (ADR 0008).
 * A program is plain data, so a run can carry it and be saved; its hash
 * names it, and the machine's version is part of it.
 */
import type { BinaryOp, Expr, Stmt } from "./ast";
import type { Unit } from "./check";

/** Raised when the instructions or the machine change, so old runs are dropped. */
export const machineVersion = 2;

/** A value as a program holds it: plain, so it can be saved. */
export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | { b: number }
  | { r: Record<string, Value> };

export type Ins =
  | ["const", Value]
  | ["load", string]
  | ["store", string]
  | ["field", string]
  | ["index"]
  | ["list", number]
  | ["concat", number]
  | ["callq", string, number]
  | ["callc", string, number]
  | ["bin", BinaryOp]
  | ["not"]
  | ["neg"]
  | ["jump", number]
  | ["jf", number]
  | ["iter", string, string, string, number]
  /** A game command: its id, its choices as segments, how many values, await. */
  | ["cmd", string, string[], number, boolean]
  | ["wait"]
  | ["tick"]
  | ["say"]
  | ["ret"]
  | ["retv"]
  | ["stop"]
  | ["tpush", number]
  | ["tpop"];

export interface Fn {
  kind: "main" | "cmd" | "qry";
  params: string[];
  code: Ins[];
  /** The line of each instruction, and the script it comes from. */
  lines: number[];
  script: string;
}

export interface Program {
  version: number;
  /** The script it was made for, and the sources it was made from. */
  name: string;
  sources: Record<string, string>;
  /** `every`, and the whole script's timeout, in seconds of play. */
  every?: number;
  timeout: number;
  /** The script's own body is `main`; the others by `script:name`. */
  fns: Record<string, Fn>;
  /** What the comment above a `cmd:` or `qry:` says, by its key. */
  docs: Record<string, string>;
  hash: string;
}

/** Seconds of play a script may take without its own `timeout`: 10 minutes. */
export const defaultTimeout = 600;

export function compile(unit: Unit): Program {
  const fns: Record<string, Fn> = {
    main: body("main", [], unit.main.body, unit.name),
  };
  const docs: Record<string, string> = {};
  for (const [key, d] of unit.defs) {
    fns[key] = body(d.kind, d.params, d.body, d.script);
    if (d.doc) docs[key] = d.doc;
  }
  const program: Omit<Program, "hash"> = {
    version: machineVersion,
    name: unit.name,
    sources: unit.sources,
    every: unit.main.every?.seconds,
    timeout: unit.main.timeout?.seconds ?? defaultTimeout,
    fns,
    docs,
  };
  return {
    ...program,
    hash: hash(JSON.stringify([program.version, program.name, fns])),
  };
}

/** A short hash of a text, FNV-1a, as eight hexadecimal digits. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function body(
  kind: Fn["kind"],
  params: string[],
  stmts: Stmt[],
  script: string,
): Fn {
  const code: Ins[] = [];
  const lines: number[] = [];
  let line = 1;
  let hidden = 0;
  const emit = (ins: Ins) => {
    code.push(ins);
    lines.push(line);
    return code.length - 1;
  };
  /** Sets the target of a jump emitted before. */
  const patch = (at: number, target = code.length) => {
    const ins = code[at];
    if (ins[0] === "jump" || ins[0] === "jf") ins[1] = target;
    else if (ins[0] === "iter") ins[4] = target;
    else if (ins[0] === "tpush") ins[1] = target;
  };

  const expr = (e: Expr): void => {
    line = e.at.line;
    switch (e.k) {
      case "num":
      case "bool":
        emit(["const", e.v]);
        return;
      case "none":
        emit(["const", null]);
        return;
      case "str": {
        if (!e.parts.length) {
          emit(["const", ""]);
          return;
        }
        for (const p of e.parts)
          if (typeof p === "string") emit(["const", p]);
          else expr(p);
        if (e.parts.length !== 1 || typeof e.parts[0] !== "string")
          emit(["concat", e.parts.length]);
        return;
      }
      case "name":
        if (e.ref?.k === "qry") emit(["callq", e.ref.key, 0]);
        else if (e.ref?.k === "query") emit(["callq", e.ref.name, 0]);
        else emit(["load", e.name]);
        return;
      case "list":
        e.items.forEach(expr);
        emit(["list", e.items.length]);
        return;
      case "field":
        expr(e.obj);
        line = e.at.line;
        emit(["field", e.name]);
        return;
      case "index":
        expr(e.obj);
        expr(e.index);
        emit(["index"]);
        return;
      case "call":
        e.args.forEach(expr);
        line = e.at.line;
        emit([
          "callq",
          e.ref?.k === "qry"
            ? e.ref.key
            : e.ref?.k === "query"
              ? e.ref.name
              : e.name,
          e.args.length,
        ]);
        return;
      case "not":
        expr(e.a);
        emit(["not"]);
        return;
      case "neg":
        expr(e.a);
        emit(["neg"]);
        return;
      case "bin":
        if (e.op === "and" || e.op === "or") {
          // Short-circuit: the right side only if needed.
          expr(e.a);
          if (e.op === "and") {
            const skip = emit(["jf", -1]);
            expr(e.b);
            emit(["not"]);
            emit(["not"]);
            const end = emit(["jump", -1]);
            patch(skip);
            emit(["const", false]);
            patch(end);
          } else {
            emit(["not"]);
            const skip = emit(["jf", -1]);
            expr(e.b);
            emit(["not"]);
            emit(["not"]);
            const end = emit(["jump", -1]);
            patch(skip);
            emit(["const", true]);
            patch(end);
          }
          return;
        }
        expr(e.a);
        expr(e.b);
        line = e.at.line;
        emit(["bin", e.op]);
        return;
    }
  };

  const stmt = (s: Stmt): void => {
    line = s.at.line;
    switch (s.k) {
      case "var":
      case "set":
        expr(s.value);
        line = s.at.line;
        emit(["store", s.name]);
        return;
      case "if": {
        const ends: number[] = [];
        for (const b of s.branches) {
          expr(b.cond);
          const next = emit(["jf", -1]);
          b.body.forEach(stmt);
          ends.push(emit(["jump", -1]));
          patch(next);
        }
        s.otherwise?.forEach(stmt);
        for (const e of ends) patch(e);
        return;
      }
      case "while": {
        const top = code.length;
        expr(s.cond);
        const out = emit(["jf", -1]);
        s.body.forEach(stmt);
        emit(["jump", top]);
        patch(out);
        return;
      }
      case "for": {
        const n = hidden++;
        if (s.to) {
          const end = `$end${n}`;
          expr(s.from);
          emit(["store", s.name]);
          expr(s.to);
          emit(["store", end]);
          const top = code.length;
          emit(["load", s.name]);
          emit(["load", end]);
          emit(["bin", "<="]);
          const out = emit(["jf", -1]);
          s.body.forEach(stmt);
          line = s.at.line;
          emit(["load", s.name]);
          emit(["const", 1]);
          emit(["bin", "+"]);
          emit(["store", s.name]);
          emit(["jump", top]);
          patch(out);
        } else {
          const list = `$list${n}`;
          const index = `$index${n}`;
          expr(s.from);
          emit(["store", list]);
          emit(["const", 0]);
          emit(["store", index]);
          const top = emit(["iter", list, index, s.name, -1]);
          s.body.forEach(stmt);
          emit(["jump", top]);
          patch(top);
        }
        return;
      }
      case "wait":
        expr(s.seconds);
        emit(["wait"]);
        return;
      case "until": {
        const top = code.length;
        expr(s.cond);
        emit(["not"]);
        const out = emit(["jf", -1]);
        emit(["tick"]);
        emit(["jump", top]);
        patch(out);
        return;
      }
      case "command": {
        s.args.forEach(expr);
        line = s.at.line;
        if (s.ref?.k === "cmd") emit(["callc", s.ref.key, s.args.length]);
        else if (s.ref?.k === "game")
          emit(["cmd", s.ref.id, s.ref.segments, s.args.length, s.await]);
        else throw new Error(`Unchecked command ${s.name}`);
        return;
      }
      case "timeout": {
        expr(s.seconds);
        const push = emit(["tpush", -1]);
        s.body.forEach(stmt);
        emit(["tpop"]);
        const end = emit(["jump", -1]);
        patch(push);
        s.otherwise?.forEach(stmt);
        patch(end);
        return;
      }
      case "say":
        expr(s.value);
        emit(["say"]);
        return;
      case "return":
        if (s.value) {
          expr(s.value);
          emit(["retv"]);
        } else emit(["ret"]);
        return;
      case "stop":
        emit(["stop"]);
        return;
    }
  };

  stmts.forEach(stmt);
  return { kind, params, code, lines, script };
}
