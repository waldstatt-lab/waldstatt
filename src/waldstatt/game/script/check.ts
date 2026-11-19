/**
 * Checks a script before it can run (ADR 0007): that every name is known
 * where it is used, that calls have the right number of values, that imports
 * exist, clash with nothing and go in no circle, and that commands and
 * queries stay apart (Command-Query Separation). A command (the game's or a
 * `cmd:`) is a statement and returns nothing; a query (the game's or a
 * `qry:`) is an expression and changes nothing, so a `qry:` holds no
 * command, wait, await, `say`, `stop` or `timeout`, and returns a value; a
 * `cmd:` returns none. The checked script and its imports are linked into
 * one unit for the compiler.
 */
import {
  ScriptError,
  type Def,
  type Expr,
  type Pos,
  type Script,
  type Stmt,
} from "./ast";
import { parse } from "./parse";

/** What the game offers scripts, for the checker and the editor. */
export interface Library {
  /** The game's queries: their names, how many values they take, what they give. */
  queries: Record<string, { args: [number, number]; describe: string }>;
  /**
   * Whether a game command as written reads, or why not; for a command with
   * `{…}` only its fixed beginning is given, ending in «:».
   */
  command(text: string): string | undefined;
}

/** A script with its imports, checked and ready to compile. */
export interface Unit {
  /** The script's own name. */
  name: string;
  /** The sources it was made from, by script name, imports included. */
  sources: Record<string, string>;
  main: Script;
  /** Every `cmd:` and `qry:` usable in it, its own and imported. */
  defs: Map<string, Def & { script: string }>;
}

const limits = { imports: 16 };

/**
 * Reads, links and checks a script and what it imports; `source` finds a
 * script's text by name. Throws a ScriptError at the first mistake.
 */
export function check(
  name: string,
  source: (name: string) => string | undefined,
  library: Library,
): Unit {
  const sources: Record<string, string> = {};
  const parsed = new Map<string, Script>();
  const read = (script: string, at: Pos, from?: string): Script => {
    let s = parsed.get(script);
    if (s) return s;
    const text = source(script);
    if (text === undefined)
      throw new ScriptError(`Das Skript «${script}» gibt es nicht.`, at, from);
    sources[script] = text;
    try {
      s = parse(text);
    } catch (error) {
      if (error instanceof ScriptError && script !== name)
        throw new ScriptError(error.message, error.at, script);
      throw error;
    }
    parsed.set(script, s);
    return s;
  };
  const main = read(name, { line: 1, col: 1 });

  // Imports: every script reached, no circle, no names twice.
  const defs = new Map<string, Def & { script: string }>();
  const visiting: string[] = [];
  const visit = (script: string, s: Script) => {
    visiting.push(script);
    for (const d of s.defs) {
      const other = defs.get(d.name);
      if (other)
        throw new ScriptError(
          other.script === script
            ? `«${d.name}» gibt es schon in diesem Skript.`
            : `«${d.name}» gibt es schon im Skript «${other.script}».`,
          d.at,
          script === name ? undefined : script,
        );
      defs.set(d.name, { ...d, script });
    }
    for (const imp of s.imports) {
      if (visiting.includes(imp.name))
        throw new ScriptError(
          `«${imp.name}» importiert sich im Kreis: ${[...visiting, imp.name].join(" → ")}.`,
          imp.at,
          script === name ? undefined : script,
        );
      if (parsed.has(imp.name)) continue;
      if (parsed.size >= limits.imports)
        throw new ScriptError(
          `Mehr als ${limits.imports} Skripte zusammen gehen nicht.`,
          imp.at,
        );
      visit(
        imp.name,
        read(imp.name, imp.at, script === name ? undefined : script),
      );
    }
    visiting.pop();
  };
  visit(name, main);
  for (const d of defs.values())
    if (library.queries[d.name])
      throw new ScriptError(
        `«${d.name}» ist schon eine Abfrage des Spiels.`,
        d.at,
        d.script === name ? undefined : d.script,
      );

  const unit: Unit = { name, sources, main, defs };
  for (const d of defs.values()) checkBody(unit, library, d.body, d, d.script);
  checkBody(unit, library, main.body, undefined, name);
  return unit;
}

/** The kind of body being checked: the script itself, a command or a query. */
function checkBody(
  unit: Unit,
  library: Library,
  body: Stmt[],
  def: (Def & { script: string }) | undefined,
  script: string,
) {
  const where = script === unit.name ? undefined : script;
  const fail = (message: string, at: Pos): never => {
    throw new ScriptError(message, at, where);
  };
  const isQuery = def?.kind === "qry";
  const scopes: Set<string>[] = [new Set(def?.params ?? [])];
  const known = (n: string) => scopes.some((s) => s.has(n));
  const declare = (n: string, at: Pos) => {
    // No name twice, not even in an inner block: one name, one value.
    if (known(n)) fail(`«${n}» gibt es hier schon.`, at);
    if (library.queries[n] || unit.defs.has(n))
      fail(`«${n}» ist schon eine Abfrage oder ein Befehl.`, at);
    scopes[scopes.length - 1].add(n);
  };
  const block = (stmts: Stmt[], extra?: [string, Pos]) => {
    scopes.push(new Set());
    if (extra) declare(...extra);
    for (const s of stmts) stmt(s);
    scopes.pop();
  };
  const noEffect = (what: string, at: Pos) => {
    if (isQuery)
      fail(
        `${what} hat in einer Abfrage nichts verloren: «qry:${def?.name}» gibt nur einen Wert zurück und ändert nichts.`,
        at,
      );
  };

  const expr = (e: Expr): void => {
    switch (e.k) {
      case "num":
      case "bool":
      case "none":
        return;
      case "str":
        for (const p of e.parts) if (typeof p !== "string") expr(p);
        return;
      case "name":
        if (known(e.name)) return;
        if (library.queries[e.name]) {
          const [min] = library.queries[e.name].args;
          if (min > 0) fail(`«${e.name}» braucht Werte: «${e.name}(…)».`, e.at);
          return;
        }
        if (unit.defs.get(e.name)?.kind === "qry")
          fail(`«${e.name}» ist eine Abfrage: «${e.name}(…)».`, e.at);
        if (unit.defs.get(e.name)?.kind === "cmd")
          fail(
            `«${e.name}» ist ein Befehl und gibt nichts zurück. Frag danach ab, was er bewirkt hat.`,
            e.at,
          );
        return fail(
          e.name.includes("-") &&
            e.name.split("-").every((p) => p && (known(p) || /^\d/.test(p)))
            ? `«${e.name}» ist ein Name. Zum Abziehen Leerzeichen: «${e.name.split("-").join(" - ")}».`
            : `«${e.name}» ist unbekannt.`,
          e.at,
        );
      case "list":
        e.items.forEach(expr);
        return;
      case "field":
        expr(e.obj);
        return;
      case "index":
        expr(e.obj);
        expr(e.index);
        return;
      case "call": {
        e.args.forEach(expr);
        const own = unit.defs.get(e.name);
        if (own?.kind === "cmd")
          fail(
            `«${e.name}» ist ein Befehl: er steht allein als «${e.name}:…» und gibt nichts zurück.`,
            e.at,
          );
        if (own) {
          if (own.params.length !== e.args.length)
            fail(
              `«${e.name}» braucht ${own.params.length} ${own.params.length === 1 ? "Wert" : "Werte"}.`,
              e.at,
            );
          return;
        }
        const q = library.queries[e.name];
        if (!q) return fail(`Die Abfrage «${e.name}» gibt es nicht.`, e.at);
        const [min, max] = q.args;
        if (e.args.length < min || e.args.length > max)
          fail(
            `«${e.name}» braucht ${min === max ? min : `${min} bis ${max}`} ${max === 1 ? "Wert" : "Werte"}.`,
            e.at,
          );
        return;
      }
      case "not":
      case "neg":
        expr(e.a);
        return;
      case "bin":
        expr(e.a);
        expr(e.b);
        return;
    }
  };

  const stmt = (s: Stmt): void => {
    switch (s.k) {
      case "var":
        expr(s.value);
        declare(s.name, s.at);
        return;
      case "set":
        if (!known(s.name))
          fail(`«${s.name}» ist unbekannt: zuerst «var ${s.name} = …».`, s.at);
        expr(s.value);
        return;
      case "if":
        for (const b of s.branches) {
          expr(b.cond);
          block(b.body);
        }
        if (s.otherwise) block(s.otherwise);
        return;
      case "while":
        expr(s.cond);
        block(s.body);
        return;
      case "for":
        expr(s.from);
        if (s.to) expr(s.to);
        block(s.body, [s.name, s.at]);
        return;
      case "wait":
        noEffect("Warten", s.at);
        expr(s.seconds);
        return;
      case "until":
        noEffect("Warten", s.at);
        expr(s.cond);
        return;
      case "timeout":
        noEffect("Eine Zeitgrenze", s.at);
        expr(s.seconds);
        block(s.body);
        if (s.otherwise) block(s.otherwise);
        return;
      case "say":
        noEffect("«say»", s.at);
        expr(s.value);
        return;
      case "stop":
        noEffect("«stop»", s.at);
        return;
      case "return":
        if (!def)
          fail(
            "«return» gehört in «cmd:» oder «qry:»; das Skript endet mit «stop».",
            s.at,
          );
        if (def?.kind === "qry" && !s.value)
          fail(`«qry:${def.name}» gibt mit «return» einen Wert zurück.`, s.at);
        if (def?.kind === "cmd" && s.value)
          fail(
            `«cmd:${def.name}» ist ein Befehl und gibt nichts zurück. Schreib eine Abfrage «qry:» für den Wert.`,
            s.at,
          );
        if (s.value) expr(s.value);
        return;
      case "command": {
        noEffect("Ein Befehl", s.at);
        for (const p of s.text) if (typeof p !== "string") expr(p);
        const first = s.text[0];
        const head = typeof first === "string" ? first.split(":")[0] : "";
        const own = unit.defs.get(head);
        if (own?.kind === "qry")
          fail(
            `«${head}» ist eine Abfrage: «var x = ${head}(…)». Ein Befehl ist sie nicht.`,
            s.at,
          );
        if (own) {
          // The segments after the name are the values.
          const literal = s.text.every((p) => typeof p === "string");
          if (literal) {
            const args = s.text.join("").split(":").slice(1);
            if (args.length !== own.params.length)
              fail(
                `«${head}» braucht ${own.params.length} ${own.params.length === 1 ? "Wert" : "Werte"}: «${[head, ...own.params.map((p) => `{${p}}`)].join(":")}».`,
                s.at,
              );
          }
          if (s.await)
            fail(
              `«await» wartet auf Befehle des Spiels; «${head}» wartet in sich selbst.`,
              s.at,
            );
          return;
        }
        // The game's command: as written, or its fixed beginning.
        const literal = s.text.every((p) => typeof p === "string");
        const text = literal
          ? (s.text as string[]).join("")
          : `${(s.text.find((p) => typeof p === "string") as string | undefined)?.split(":").slice(0, -1).join(":") ?? ""}:`;
        const why = library.command(text);
        if (why) fail(why, s.at);
        return;
      }
    }
  };

  for (const s of body) stmt(s);
}
