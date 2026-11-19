/**
 * Reads a script of the Waldstatt's language (ADR 0007) into its syntax tree
 * (ast.ts). One statement per line, or several commands joined by «;»; `#`
 * begins a comment; blocks close with `end`. A statement that begins with a
 * name and a colon, or is a lone name, is a command, read as it is typed:
 * `build:hütte`, `repair:under:{limit}`, `enter`. Expressions are read by
 * precedence: `or`, `and`, `not`, comparisons, `+` `-`, `*` `/` `%`, a
 * leading `-`, then fields, indices and calls. Names may contain hyphens, as
 * commands do (`genug-holz`), so subtraction needs spaces. A number with
 * `s`, `m` or `h` right after it is a duration in seconds (`30s`, `2m`).
 */
import {
  ScriptError,
  type BinaryOp,
  type Def,
  type Expr,
  type Pos,
  type Script,
  type Stmt,
  type Template,
} from "./ast";

const limits = {
  /** Characters of a script, lines, and depth of nested blocks. */
  chars: 50_000,
  lines: 2_000,
  depth: 32,
};

const keywords = new Set([
  "var",
  "if",
  "then",
  "elif",
  "else",
  "end",
  "for",
  "in",
  "while",
  "do",
  "wait",
  "until",
  "await",
  "timeout",
  "say",
  "return",
  "stop",
  "import",
  "every",
  "cmd",
  "qry",
  "and",
  "or",
  "not",
  "true",
  "false",
  "none",
]);

export const scriptKeywords = [...keywords];

/** A name: a letter or `_`, then letters, digits, `_`, hyphens inside. */
const nameAt = /^[\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*/u;

// --- Expressions -------------------------------------------------------------------

type Token =
  | { t: "num"; v: number; at: Pos }
  | { t: "str"; raw: string; at: Pos }
  | { t: "name"; v: string; at: Pos }
  | { t: "op"; v: string; at: Pos }
  | { t: "end"; at: Pos };

const units: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** Splits a piece of a line into tokens; `col` is where it begins. */
function tokenize(text: string, line: number, col: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const at = (): Pos => ({ line, col: col + i });
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = at();
    const rest = text.slice(i);
    const num = /^\d+(?:\.\d+)?/.exec(rest);
    if (num) {
      i += num[0].length;
      let v = Number(num[0]);
      const unit = /^[smh](?![\p{L}\p{N}_])/u.exec(text.slice(i));
      if (unit) {
        v *= units[unit[0]];
        i++;
      } else if (/^[\p{L}_]/u.test(text.slice(i)))
        throw new ScriptError(
          `«${num[0]}${text.slice(i).split(/\s/)[0]}» ist weder Zahl noch Dauer: Dauern sind wie 30s, 2m, 1h.`,
          pos,
        );
      tokens.push({ t: "num", v, at: pos });
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let depth = 0;
      while (j < text.length && (text[j] !== '"' || depth > 0)) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth = Math.max(0, depth - 1);
        j++;
      }
      if (j >= text.length)
        throw new ScriptError('Ein Text endet nicht: das «"» fehlt.', pos);
      tokens.push({ t: "str", raw: text.slice(i + 1, j), at: pos });
      i = j + 1;
      continue;
    }
    const name = nameAt.exec(rest);
    if (name) {
      tokens.push({ t: "name", v: name[0], at: pos });
      i += name[0].length;
      continue;
    }
    const op = /^(==|!=|<=|>=|\.\.|[-+*/%<>()[\],.=:;])/.exec(rest);
    if (op) {
      tokens.push({ t: "op", v: op[0], at: pos });
      i += op[0].length;
      continue;
    }
    throw new ScriptError(`«${c}» gehört nicht hierher.`, pos);
  }
  tokens.push({ t: "end", at: at() });
  return tokens;
}

const binary: Record<string, [number, BinaryOp]> = {
  or: [1, "or"],
  and: [2, "and"],
  "==": [4, "=="],
  "!=": [4, "!="],
  "<": [4, "<"],
  "<=": [4, "<="],
  ">": [4, ">"],
  ">=": [4, ">="],
  "+": [5, "+"],
  "-": [5, "-"],
  "*": [6, "*"],
  "/": [6, "/"],
  "%": [6, "%"],
};

class ExprReader {
  private i = 0;

  constructor(private tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.i];
  }

  next(): Token {
    return this.tokens[this.i++];
  }

  atEnd(): boolean {
    return this.peek().t === "end";
  }

  isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }

  isWord(v: string): boolean {
    const t = this.peek();
    return t.t === "name" && t.v === v;
  }

  expectOp(v: string, what: string) {
    if (!this.isOp(v)) throw new ScriptError(what, this.peek().at);
    this.next();
  }

  expr(min = 0): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      const key = t.t === "op" || t.t === "name" ? t.v : "";
      const op = binary[key];
      if (!op || op[0] <= min) return left;
      this.next();
      const right = this.expr(op[0]);
      left = { k: "bin", op: op[1], a: left, b: right, at: t.at };
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.t === "name" && t.v === "not") {
      this.next();
      return { k: "not", a: this.expr(3), at: t.at };
    }
    if (t.t === "op" && t.v === "-") {
      this.next();
      return { k: "neg", a: this.unary(), at: t.at };
    }
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && t.v === ".") {
        this.next();
        const name = this.next();
        if (name.t !== "name")
          throw new ScriptError("Nach «.» kommt der Name eines Feldes.", t.at);
        e = { k: "field", obj: e, name: name.v, at: t.at };
      } else if (t.t === "op" && t.v === "[") {
        this.next();
        const index = this.expr();
        this.expectOp("]", "Eine «]» fehlt.");
        e = { k: "index", obj: e, index, at: t.at };
      } else return e;
    }
  }

  private primary(): Expr {
    const t = this.next();
    if (t.t === "num") return { k: "num", v: t.v, at: t.at };
    if (t.t === "str")
      return { k: "str", parts: interpolate(t.raw, t.at), at: t.at };
    if (t.t === "op" && t.v === "(") {
      const e = this.expr();
      this.expectOp(")", "Eine «)» fehlt.");
      return e;
    }
    if (t.t === "op" && t.v === "[") {
      const items: Expr[] = [];
      if (!this.isOp("]"))
        for (;;) {
          items.push(this.expr());
          if (this.isOp(",")) this.next();
          else break;
        }
      this.expectOp("]", "Eine «]» fehlt.");
      return { k: "list", items, at: t.at };
    }
    if (t.t === "name") {
      if (t.v === "true" || t.v === "false")
        return { k: "bool", v: t.v === "true", at: t.at };
      if (t.v === "none") return { k: "none", at: t.at };
      if (keywords.has(t.v))
        throw new ScriptError(
          `«${t.v}» ist ein Schlüsselwort, kein Wert.`,
          t.at,
        );
      if (this.isOp(":"))
        throw new ScriptError(
          `«${t.v}:…» ist ein Befehl, und ein Befehl gibt nichts zurück. Frag danach ab, was er bewirkt hat.`,
          t.at,
        );
      if (this.isOp("(")) {
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(")"))
          for (;;) {
            args.push(this.expr());
            if (this.isOp(",")) this.next();
            else break;
          }
        this.expectOp(")", "Eine «)» fehlt.");
        return { k: "call", name: t.v, args, at: t.at };
      }
      return { k: "name", name: t.v, at: t.at };
    }
    if (t.t === "end") throw new ScriptError("Hier fehlt ein Wert.", t.at);
    throw new ScriptError(`«${t.v}» gehört nicht hierher.`, t.at);
  }
}

/** Reads a whole piece of a line as one expression. */
function readExpr(text: string, line: number, col: number): Expr {
  const r = new ExprReader(tokenize(text, line, col));
  const e = r.expr();
  if (!r.atEnd()) {
    const t = r.peek();
    throw new ScriptError(
      `«${t.t === "name" || t.t === "op" ? t.v : "…"}» gehört nicht hierher.${t.t === "name" && /^-/.test(text.slice(t.at.col - col)) ? "" : ""}`,
      t.at,
    );
  }
  return e;
}

/** The parts of a text or a command: literal text and `{expressions}`. */
function interpolate(raw: string, at: Pos): (string | Expr)[] {
  const parts: (string | Expr)[] = [];
  let i = 0;
  let literal = "";
  while (i < raw.length) {
    if (raw[i] === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth++;
        else if (raw[j] === "}") depth--;
        j++;
      }
      if (depth > 0)
        throw new ScriptError("Eine «}» fehlt.", {
          line: at.line,
          col: at.col + i,
        });
      if (literal) parts.push(literal);
      literal = "";
      parts.push(readExpr(raw.slice(i + 1, j - 1), at.line, at.col + i + 2));
      i = j;
    } else literal += raw[i++];
  }
  if (literal) parts.push(literal);
  return parts;
}

// --- Statements ------------------------------------------------------------------------

/** A piece of a line: its text, trimmed, and where it begins. */
interface Piece {
  text: string;
  line: number;
  col: number;
}

/** Splits a line at «;» outside texts, braces and brackets, and drops `#…`. */
function pieces(source: string, line: number): Piece[] {
  const out: Piece[] = [];
  let depth = 0;
  let inText = false;
  let start = 0;
  const push = (end: number) => {
    const raw = source.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, line, col: start + lead + 1 });
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') inText = !inText;
    else if (inText) continue;
    else if ("{([".includes(c)) depth++;
    else if ("})]".includes(c)) depth--;
    else if (c === "#" && depth === 0) {
      push(i);
      return out;
    } else if (c === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(source.length);
  return out;
}

type Block =
  | { k: "script"; body: Stmt[] }
  | { k: "def"; def: Def; body: Stmt[] }
  | { k: "if"; stmt: Extract<Stmt, { k: "if" }>; body: Stmt[] }
  | {
      k: "while" | "for";
      stmt: Extract<Stmt, { k: "while" | "for" }>;
      body: Stmt[];
    }
  | {
      k: "timeout";
      stmt: Extract<Stmt, { k: "timeout" }>;
      body: Stmt[];
    };

/** Reads a whole script; throws a ScriptError at the first mistake. */
export function parse(source: string): Script {
  if (source.length > limits.chars)
    throw new ScriptError(`Mehr als ${limits.chars} Zeichen gehen nicht.`, {
      line: 1,
      col: 1,
    });
  const lines = source.split(/\r?\n/);
  if (lines.length > limits.lines)
    throw new ScriptError(`Mehr als ${limits.lines} Zeilen gehen nicht.`, {
      line: limits.lines + 1,
      col: 1,
    });
  const script: Script = { imports: [], defs: [], body: [] };
  const stack: Block[] = [{ k: "script", body: script.body }];
  /** Still at the top, where imports, `every` and the whole timeout go. */
  let header = true;
  const top = () => stack[stack.length - 1];
  const open = (block: Block, at: Pos) => {
    if (stack.length > limits.depth)
      throw new ScriptError("Zu viele Blöcke ineinander.", at);
    stack.push(block);
  };
  const add = (stmt: Stmt) => {
    header = false;
    top().body.push(stmt);
  };

  for (const [n, sourceLine] of lines.entries()) {
    for (const p of pieces(sourceLine, n + 1)) {
      const at: Pos = { line: p.line, col: p.col };
      const word = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(p.text)?.[0] ?? "";
      const after = p.text.slice(word.length);
      const rest = after.trim();
      const restCol =
        p.col + word.length + (after.length - after.trimStart().length);
      const expr = (text = rest, col = restCol) => readExpr(text, p.line, col);
      const needEnd = (k: string) => {
        if (rest && rest !== "do")
          throw new ScriptError(
            `Nach «${k}» kommt nichts mehr auf die Zeile.`,
            at,
          );
      };

      // --- Top: imports, `every`, the whole timeout, definitions.
      if (word === "import") {
        if (!header || stack.length > 1)
          throw new ScriptError(
            "«import» gehört an den Anfang des Skripts.",
            at,
          );
        const name = nameAt.exec(rest)?.[0];
        if (!name || name !== rest)
          throw new ScriptError(
            "Nach «import» kommt der Name eines Skripts.",
            at,
          );
        script.imports.push({ name, at });
        continue;
      }
      if (word === "every") {
        if (!header || stack.length > 1)
          throw new ScriptError(
            "«every» gehört an den Anfang des Skripts.",
            at,
          );
        const e = expr();
        if (e.k !== "num" || e.v < 1)
          throw new ScriptError(
            "«every» braucht eine Dauer ab 1s, wie 30s oder 2m.",
            at,
          );
        script.every = { seconds: e.v, at };
        continue;
      }
      if (
        word === "timeout" &&
        header &&
        stack.length === 1 &&
        !closesLater(lines, n, p)
      ) {
        const e = expr();
        if (e.k !== "num" || e.v <= 0)
          throw new ScriptError("«timeout» braucht eine Dauer, wie 10m.", at);
        script.timeout = { seconds: e.v, at };
        continue;
      }
      if ((word === "cmd" || word === "qry") && after.startsWith(":")) {
        if (stack.length > 1)
          throw new ScriptError(`«${word}:» steht nicht in einem Block.`, at);
        const m =
          /^:([\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*)\s*\(([^)]*)\)\s*$/u.exec(
            after,
          );
        if (!m)
          throw new ScriptError(
            `So: «${word}:name(a, b)» und darunter der Block bis «end».`,
            at,
          );
        const params = m[2]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const param of params)
          if (
            !nameAt.test(param) ||
            nameAt.exec(param)?.[0] !== param ||
            keywords.has(param)
          )
            throw new ScriptError(
              `«${param}» ist kein Name für einen Wert.`,
              at,
            );
        if (new Set(params).size !== params.length)
          throw new ScriptError("Zwei Werte gleichen Namens.", at);
        const def: Def = { kind: word, name: m[1], params, body: [], at };
        script.defs.push(def);
        header = false;
        open({ k: "def", def, body: def.body }, at);
        continue;
      }

      // --- Closing and continuing blocks.
      if (word === "end") {
        if (rest)
          throw new ScriptError(
            "Nach «end» kommt nichts mehr auf die Zeile.",
            at,
          );
        const block = top();
        if (block.k === "script")
          throw new ScriptError("Ein «end» zu viel.", at);
        stack.pop();
        if (block.k === "if") {
          const last = block.stmt.branches[block.stmt.branches.length - 1];
          if (block.stmt.otherwise) block.stmt.otherwise = block.body;
          else last.body = block.body;
        } else if (block.k === "timeout") {
          if (block.stmt.otherwise) block.stmt.otherwise = block.body;
          else block.stmt.body = block.body;
        } else if (block.k === "while" || block.k === "for")
          block.stmt.body = block.body;
        continue;
      }
      if (word === "elif" || (word === "else" && /^if\b/.test(rest))) {
        const block = top();
        if (block.k !== "if" || block.stmt.otherwise)
          throw new ScriptError(`«${word}» ohne «if» davor.`, at);
        const text = word === "elif" ? rest : rest.slice(2).trim();
        const col = word === "elif" ? restCol : restCol + rest.indexOf(text);
        const m = /^(.*)\s+then$/s.exec(text);
        if (!m) throw new ScriptError("Die Bedingung endet mit «then».", at);
        block.stmt.branches[block.stmt.branches.length - 1].body = block.body;
        block.stmt.branches.push({ cond: expr(m[1], col), body: [] });
        block.body = [];
        continue;
      }
      if (word === "else") {
        const block = top();
        if (rest)
          throw new ScriptError(
            "Nach «else» kommt nichts mehr auf die Zeile.",
            at,
          );
        if (block.k === "if" && !block.stmt.otherwise) {
          block.stmt.branches[block.stmt.branches.length - 1].body = block.body;
          block.stmt.otherwise = [];
          block.body = [];
          continue;
        }
        if (block.k === "timeout" && !block.stmt.otherwise) {
          block.stmt.body = block.body;
          block.stmt.otherwise = [];
          block.body = [];
          continue;
        }
        throw new ScriptError("«else» ohne «if» oder «timeout» davor.", at);
      }

      // --- Blocks.
      if (word === "if") {
        const m = /^(.*)\s+then$/s.exec(rest);
        if (!m) throw new ScriptError("Die Bedingung endet mit «then».", at);
        const stmt: Extract<Stmt, { k: "if" }> = {
          k: "if",
          branches: [{ cond: expr(m[1]), body: [] }],
          at,
        };
        add(stmt);
        open({ k: "if", stmt, body: [] }, at);
        continue;
      }
      if (word === "while") {
        const text = rest.replace(/\s+do$/, "");
        const stmt: Extract<Stmt, { k: "while" }> = {
          k: "while",
          cond: expr(text),
          body: [],
          at,
        };
        add(stmt);
        open({ k: "while", stmt, body: [] }, at);
        continue;
      }
      if (word === "for") {
        const m =
          /^([\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*)\s+in\s+(.+?)(?:\s+do)?$/su.exec(
            rest,
          );
        if (!m)
          throw new ScriptError(
            "So: «for i in 1..10» oder «for b in liste».",
            at,
          );
        if (keywords.has(m[1]))
          throw new ScriptError(`«${m[1]}» ist ein Schlüsselwort.`, at);
        const col = restCol + rest.indexOf(m[2], m[1].length);
        // A range: «a..b» at the top level of the expression.
        const tokens = tokenize(m[2], p.line, col);
        let depth = 0;
        let split = -1;
        for (const [i, t] of tokens.entries()) {
          if (t.t === "op" && "([".includes(t.v)) depth++;
          else if (t.t === "op" && ")]".includes(t.v)) depth--;
          else if (t.t === "op" && t.v === ".." && depth === 0) split = i;
        }
        let stmt: Extract<Stmt, { k: "for" }>;
        if (split >= 0) {
          const cut = tokens[split].at.col - col;
          stmt = {
            k: "for",
            name: m[1],
            from: expr(m[2].slice(0, cut), col),
            to: expr(m[2].slice(cut + 2), col + cut + 2),
            body: [],
            at,
          };
        } else
          stmt = { k: "for", name: m[1], from: expr(m[2], col), body: [], at };
        add(stmt);
        open({ k: "for", stmt, body: [] }, at);
        continue;
      }
      if (word === "timeout") {
        const stmt: Extract<Stmt, { k: "timeout" }> = {
          k: "timeout",
          seconds: expr(),
          body: [],
          at,
        };
        add(stmt);
        open({ k: "timeout", stmt, body: [] }, at);
        continue;
      }

      // --- Simple statements.
      if (word === "var") {
        const m =
          /^([\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*)\s*=(?!=)\s*(.*)$/su.exec(
            rest,
          );
        if (!m) throw new ScriptError("So: «var name = wert».", at);
        if (keywords.has(m[1]))
          throw new ScriptError(`«${m[1]}» ist ein Schlüsselwort.`, at);
        add({
          k: "var",
          name: m[1],
          value: expr(m[2], restCol + rest.indexOf(m[2], m[1].length)),
          at,
        });
        continue;
      }
      if (word === "wait") {
        if (/^until\b/.test(rest)) {
          const text = rest.slice(5).trim();
          add({
            k: "until",
            cond: expr(text, restCol + rest.indexOf(text, 5)),
            at,
          });
        } else add({ k: "wait", seconds: expr(), at });
        continue;
      }
      if (word === "await") {
        add({ ...command(rest, p.line, restCol), await: true, at });
        continue;
      }
      if (word === "say") {
        add({ k: "say", value: expr(), at });
        continue;
      }
      if (word === "return") {
        add(rest ? { k: "return", value: expr(), at } : { k: "return", at });
        continue;
      }
      if (word === "stop") {
        needEnd("stop");
        add({ k: "stop", at });
        continue;
      }
      if (keywords.has(word) && word !== "cmd" && word !== "qry")
        throw new ScriptError(
          `«${word}» gehört nicht an den Anfang einer Zeile.`,
          at,
        );

      // --- Assignment, a query where a statement belongs, or a command.
      const name = nameAt.exec(p.text)?.[0] ?? "";
      const tail = p.text.slice(name.length);
      if (name && /^\s*=(?!=)/.test(tail)) {
        const value = tail.replace(/^\s*=\s*/, "");
        add({
          k: "set",
          name,
          value: expr(value, p.col + p.text.length - value.length),
          at,
        });
        continue;
      }
      if (name && /^\s*\(/.test(tail))
        throw new ScriptError(
          `«${name}(…)» ist eine Abfrage: sie gibt einen Wert zurück und tut nichts. Verwende ihren Wert, wie in «var x = ${name}(…)».`,
          at,
        );
      if (name && /^(?::|\s*$)/.test(tail)) {
        add({ ...command(p.text, p.line, p.col), await: false, at });
        continue;
      }
      throw new ScriptError(`Das verstehe ich nicht: «${p.text}».`, at);
    }
  }
  if (stack.length > 1) {
    const block = top();
    const what =
      block.k === "def"
        ? `«${block.def.kind}:${block.def.name}»`
        : `«${block.k}»`;
    throw new ScriptError(`Für ${what} fehlt das «end».`, {
      line: lines.length,
      col: 1,
    });
  }
  return script;
}

/**
 * Whether a block opened on a line is closed by an `end` further down, at
 * its own depth: tells a `timeout … end` block at the top of a script from
 * the `timeout` of the whole script.
 */
function closesLater(lines: string[], from: number, piece: Piece): boolean {
  let depth = 0;
  let started = false;
  for (let n = from; n < lines.length; n++)
    for (const p of pieces(lines[n], n + 1)) {
      if (!started) {
        started = p.col === piece.col && n === from;
        continue;
      }
      const word = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(p.text)?.[0] ?? "";
      if (
        ["if", "while", "for", "timeout"].includes(word) ||
        ((word === "cmd" || word === "qry") && p.text[word.length] === ":")
      )
        depth++;
      else if (word === "end") {
        if (depth === 0) return true;
        depth--;
      }
    }
  return false;
}

/** Reads a command as typed, with `{…}` for values. */
function command(
  text: string,
  line: number,
  col: number,
): { k: "command"; text: Template } {
  const at = { line, col };
  if (!text) throw new ScriptError("Hier fehlt ein Befehl.", at);
  const outside = text.replace(/\{[^}]*\}/g, "");
  if (!/^[\p{L}_][\p{L}\p{N}_:-]*$/u.test(outside))
    throw new ScriptError(
      `«${text}» ist kein Befehl: Befehle sind wie build:hütte oder repair:under:{n}, ohne Leerzeichen.`,
      at,
    );
  return { k: "command", text: interpolate(text, { line, col: col - 1 }) };
}
