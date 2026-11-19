/**
 * Compiles a checked script (check.ts) into a program for the machine
 * (machine.ts): one list of simple instructions per body, the script's own
 * and each `cmd:` and `qry:`, with the line of each instruction for errors.
 * A program is plain data, so a run can carry it and be saved; its hash
 * names it, and the machine's version is part of it.
 */
import type { BinaryOp, Expr, Stmt, Template } from "./ast";
import type { Unit } from "./check";

/** Raised when the instructions or the machine change, so old runs are dropped. */
export const machineVersion = 1;

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
  | ["cmd", (string | null)[], boolean]
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
  /** The script's own body is `main`. */
  fns: Record<string, Fn>;
  hash: string;
}

/** Seconds of play a script may take without its own `timeout`: 10 minutes. */
export const defaultTimeout = 600;

export function compile(unit: Unit): Program {
  const fns: Record<string, Fn> = {
    main: body("main", [], unit.main.body, unit.name, unit),
  };
  for (const [name, d] of unit.defs)
    fns[name] = body(d.kind, d.params, d.body, d.script, unit);
  const program: Omit<Program, "hash"> = {
    version: machineVersion,
    name: unit.name,
    sources: unit.sources,
    every: unit.main.every?.seconds,
    timeout: unit.main.timeout?.seconds ?? defaultTimeout,
    fns,
  };
  return { ...program, hash: hash(JSON.stringify([program.version, fns])) };
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
  unit: Unit,
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
        emit(["load", e.name]);
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
        emit(["callq", e.name, e.args.length]);
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

  /** A command's text: literal pieces, and `null` for each value put in. */
  const template = (t: Template): (string | null)[] =>
    t.map((p) => {
      if (typeof p === "string") return p;
      expr(p);
      return null;
    });

  /** The values of a call of the script's own `cmd:`, segment by segment. */
  const ownCall = (name: string, t: Template) => {
    const segments: (string | Expr)[][] = [[]];
    for (const p of t) {
      if (typeof p !== "string") {
        segments[segments.length - 1].push(p);
        continue;
      }
      const bits = p.split(":");
      bits.forEach((bit, i) => {
        if (i > 0) segments.push([]);
        if (bit) segments[segments.length - 1].push(bit);
      });
    }
    const args = segments.slice(1);
    for (const seg of args) {
      if (seg.length === 1 && typeof seg[0] !== "string") expr(seg[0]);
      else if (seg.every((x) => typeof x === "string")) {
        const text = (seg as string[]).join("");
        emit(["const", /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text]);
      } else {
        for (const x of seg)
          if (typeof x === "string") emit(["const", x]);
          else expr(x);
        emit(["concat", seg.length]);
      }
    }
    emit(["callc", name, args.length]);
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
        const first = s.text[0];
        const head = typeof first === "string" ? first.split(":")[0] : "";
        if (unit.defs.get(head)?.kind === "cmd") ownCall(head, s.text);
        else {
          const parts = template(s.text);
          line = s.at.line;
          emit(["cmd", parts, s.await]);
        }
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
