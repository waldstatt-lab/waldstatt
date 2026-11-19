/**
 * The syntax tree of the Waldstatt's script language (ADR 0007). Every node
 * keeps where it stands, so errors can name the line and column.
 */

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
  | { k: "name"; name: string; at: Pos }
  | { k: "list"; items: Expr[]; at: Pos }
  | { k: "field"; obj: Expr; name: string; at: Pos }
  | { k: "index"; obj: Expr; index: Expr; at: Pos }
  | { k: "call"; name: string; args: Expr[]; at: Pos }
  | { k: "not"; a: Expr; at: Pos }
  | { k: "neg"; a: Expr; at: Pos }
  | { k: "bin"; op: BinaryOp; a: Expr; b: Expr; at: Pos };

/** A command as written: literal text and values put in by braces. */
export type Template = (string | Expr)[];

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
  | { k: "command"; text: Template; await: boolean; at: Pos }
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
  name: string;
  params: string[];
  body: Stmt[];
  at: Pos;
}

export interface Script {
  imports: { name: string; at: Pos }[];
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
