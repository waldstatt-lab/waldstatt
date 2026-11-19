/**
 * The syntax tree of the Waldstatt's script language (ADR 0007, ADR 0008).
 * Every node keeps where it stands, so errors can name the line and column.
 * A name may be a path of colon segments (`repair:under`, `bauen:dorf`) and
 * begin with `$` and a namespace (`$helfer:summe`, `$waldstatt:up`); the
 * checker resolves each one and notes what it found (`ref`), for the
 * compiler.
 */

/** What a name stands for, as the checker found it. */
export type Ref =
  | { k: "var" }
  /** One of the game's queries, by its name. */
  | { k: "query"; name: string }
  /** A script's own `qry:` or `cmd:`, by its key `script:name`. */
  | { k: "qry" | "cmd"; key: string }
  /** One of the game's commands: its id and the choices written as segments. */
  | { k: "game"; id: string; segments: string[] };

export interface Pos {
  line: number;
  col: number;
}

export type BinaryOp =
  | "or"
  | "and"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type Expr =
  | { k: "num"; v: number; at: Pos }
  | { k: "str"; parts: (string | Expr)[]; at: Pos }
  | { k: "bool"; v: boolean; at: Pos }
  | { k: "none"; at: Pos }
  | { k: "name"; name: string; at: Pos; ref?: Ref }
  | { k: "list"; items: Expr[]; at: Pos }
  | { k: "field"; obj: Expr; name: string; at: Pos }
  | { k: "index"; obj: Expr; index: Expr; at: Pos }
  | { k: "call"; name: string; args: Expr[]; at: Pos; ref?: Ref }
  | { k: "not"; a: Expr; at: Pos }
  | { k: "neg"; a: Expr; at: Pos }
  | { k: "bin"; op: BinaryOp; a: Expr; b: Expr; at: Pos };

export type Stmt =
  | { k: "var"; name: string; value: Expr; at: Pos }
  | { k: "set"; name: string; value: Expr; at: Pos }
  | {
      k: "if";
      branches: { cond: Expr; body: Stmt[] }[];
      otherwise?: Stmt[];
      at: Pos;
    }
  | { k: "while"; cond: Expr; body: Stmt[]; at: Pos }
  | {
      k: "for";
      name: string;
      from: Expr;
      /** With `to`, a range of numbers, both ends included; else a list. */
      to?: Expr;
      body: Stmt[];
      at: Pos;
    }
  | { k: "wait"; seconds: Expr; at: Pos }
  | { k: "until"; cond: Expr; at: Pos }
  | {
      k: "command";
      /** As written, such as `repair:under` or `$helfer:bauen:dorf`. */
      name: string;
      args: Expr[];
      await: boolean;
      at: Pos;
      ref?: Ref;
    }
  | {
      k: "timeout";
      seconds: Expr;
      body: Stmt[];
      otherwise?: Stmt[];
      at: Pos;
    }
  | { k: "say"; value: Expr; at: Pos }
  | { k: "return"; value?: Expr; at: Pos }
  | { k: "stop"; at: Pos };

/** A command (`cmd:`) or a query (`qry:`) of the script's own. */
export interface Def {
  kind: "cmd" | "qry";
  /** May have colons, as `bauen:dorf`. */
  name: string;
  params: string[];
  body: Stmt[];
  at: Pos;
  /** The comment lines right above it, which describe it in the finder. */
  doc?: string;
}

/**
 * `import ns`, `import ns as alias`, or `import a, b as c from ns`. The
 * game's namespace is `waldstatt`.
 */
export interface Import {
  ns: string;
  alias?: string;
  names?: { name: string; alias?: string; at: Pos }[];
  at: Pos;
}

export interface Script {
  imports: Import[];
  /** `every 30s`: seconds of play between runs. */
  every?: { seconds: number; at: Pos };
  /** `timeout 10m` at the top: seconds of play the whole script may take. */
  timeout?: { seconds: number; at: Pos };
  defs: Def[];
  body: Stmt[];
}

/** An error with where it stands; lines and columns count from 1. */
export class ScriptError extends Error {
  constructor(
    message: string,
    readonly at: Pos,
    /** The script it stands in, when it is an imported one. */
    readonly script?: string,
  ) {
    super(message);
  }
}
