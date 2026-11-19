/**
 * Checks a script before it can run (ADR 0007, ADR 0008): that every name is
 * known where it is used, that calls have the right values, that the
 * scripts it uses exist and go in no circle, and that commands and queries
 * stay apart (Command-Query Separation). A command (the game's or a `cmd:`)
 * is a statement and returns nothing; a query (the game's or a `qry:`) is an
 * expression and changes nothing, so a `qry:` holds no command, wait,
 * `say`, `stop` or `timeout`, and returns a value; a `cmd:` returns none.
 *
 * The game and every script are namespaces: `$waldstatt:up(15)`,
 * `$helfer:summe(4)`. Without `$`, a name is the script's own, then one it
 * imports (`import helfer`, `import reihe from helfer`), then the game's if
 * the script has `import waldstatt`; a name that two imports bring is
 * refused where it is used. `import helfer as h` renames a namespace for
 * the script. Where a script's name hides one of the game's, a warning
 * says so. Each name used is resolved once and noted on its node (`ref`)
 * for the compiler; the scripts used are linked into one unit.
 */
import {
  ScriptError,
  type Def,
  type Expr,
  type Pos,
  type Ref,
  type Script,
  type Stmt,
} from "./ast";
import { parse } from "./parse";

/** The game's namespace. */
export const gameNs = "waldstatt";

/** A game command's values, as the checker needs them. */
export interface GameCommand {
  id: string;
  /** The segments written after the id, as values of its first choices. */
  segments: string[];
  args: {
    kind: "number" | "choice" | "text" | "any";
    name: string;
    min?: number;
    max?: number;
    optional: boolean;
    choices?: string[];
  }[];
}

/** What the game offers scripts, for the checker and the editor. */
export interface Library {
  /** The game's queries: their names, how many values they take, what they give. */
  queries: Record<string, { args: [number, number]; describe: string }>;
  /**
   * A game command by its segments as written (`repair:under`,
   * `build:hütte`), or why there is none or it cannot run in a script.
   */
  command(head: string): GameCommand | string;
}

/** A warning the editor shows; the script runs anyway. */
export interface Warning {
  message: string;
  at: Pos;
  script?: string;
}

/** A script with what it uses, checked and ready to compile. */
export interface Unit {
  /** The script's own name. */
  name: string;
  /** The sources it was made from, by script name, those it uses included. */
  sources: Record<string, string>;
  main: Script;
  /** Every `cmd:` and `qry:` of the scripts used, by key `script:name`. */
  defs: Map<string, Def & { script: string }>;
  warnings: Warning[];
}

const limits = { scripts: 16 };

/** How names are written in one script: its own, its imports, its aliases. */
interface Scope {
  own: Map<string, string>;
  /** Names imported without `$`, each to the keys (or game names) it may mean. */
  imported: Map<string, Set<string>>;
  /** Names imported from the game, with their aliases: alias → name. */
  game: Map<string, string>;
  /** `import waldstatt`: the game's names without `$`. */
  gameAll: boolean;
  /** `import x as y`: y → x; and the namespaces renamed so. */
  aliases: Map<string, string>;
  renamed: Set<string>;
}

/** All `$namespace` names used in a script, with where. */
function dollars(s: Script): { ns: string; at: Pos }[] {
  const out: { ns: string; at: Pos }[] = [];
  const name = (n: string, at: Pos) => {
    if (n.startsWith("$")) out.push({ ns: n.slice(1).split(":")[0], at });
  };
  const expr = (e: Expr): void => {
    switch (e.k) {
      case "name":
        name(e.name, e.at);
        return;
      case "call":
        name(e.name, e.at);
        e.args.forEach(expr);
        return;
      case "str":
        for (const p of e.parts) if (typeof p !== "string") expr(p);
        return;
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
      case "not":
      case "neg":
        expr(e.a);
        return;
      case "bin":
        expr(e.a);
        expr(e.b);
        return;
      default:
        return;
    }
  };
  const stmt = (st: Stmt): void => {
    switch (st.k) {
      case "var":
      case "set":
        expr(st.value);
        return;
      case "if":
        for (const b of st.branches) {
          expr(b.cond);
          b.body.forEach(stmt);
        }
        st.otherwise?.forEach(stmt);
        return;
      case "while":
        expr(st.cond);
        st.body.forEach(stmt);
        return;
      case "for":
        expr(st.from);
        if (st.to) expr(st.to);
        st.body.forEach(stmt);
        return;
      case "wait":
        expr(st.seconds);
        return;
      case "until":
        expr(st.cond);
        return;
      case "command":
        name(st.name, st.at);
        st.args.forEach(expr);
        return;
      case "timeout":
        expr(st.seconds);
        st.body.forEach(stmt);
        st.otherwise?.forEach(stmt);
        return;
      case "say":
        expr(st.value);
        return;
      case "return":
        if (st.value) expr(st.value);
        return;
      default:
        return;
    }
  };
  s.body.forEach(stmt);
  for (const d of s.defs) d.body.forEach(stmt);
  return out;
}

/**
 * Reads, links and checks a script and the scripts it uses; `source` finds
 * a script's text by name. Throws a ScriptError at the first mistake.
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
    if (script === gameNs)
      throw new ScriptError(
        `«${gameNs}» ist der Namensraum des Spiels, kein Skript.`,
        at,
        from,
      );
    const text = source(script);
    if (text === undefined)
      throw new ScriptError(`Das Skript «${script}» gibt es nicht.`, at, from);
    if (parsed.size >= limits.scripts)
      throw new ScriptError(
        `Mehr als ${limits.scripts} Skripte zusammen gehen nicht.`,
        at,
        from,
      );
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
  const where = (script: string) => (script === name ? undefined : script);

  // The scripts used, through imports and `$`, linked; no circle.
  const scopes = new Map<string, Scope>();
  const visiting: string[] = [];
  const done = new Set<string>();
  const visit = (script: string, s: Script) => {
    visiting.push(script);
    const scope: Scope = {
      own: new Map(),
      imported: new Map(),
      game: new Map(),
      gameAll: false,
      aliases: new Map(),
      renamed: new Set(),
    };
    scopes.set(script, scope);
    for (const d of s.defs) {
      if (scope.own.has(d.name))
        throw new ScriptError(
          `«${d.name}» gibt es schon in diesem Skript.`,
          d.at,
          where(script),
        );
      scope.own.set(d.name, `${script}:${d.name}`);
    }
    for (const imp of s.imports) {
      if (imp.alias) {
        if (scope.aliases.has(imp.alias) || imp.alias === gameNs)
          throw new ScriptError(
            `«${imp.alias}» steht schon für einen Namensraum.`,
            imp.at,
            where(script),
          );
        scope.aliases.set(imp.alias, imp.ns);
        scope.renamed.add(imp.ns);
      }
    }
    // The namespaces used: imported, and named with `$`.
    const used: { ns: string; at: Pos }[] = s.imports.map((i) => ({
      ns: i.ns,
      at: i.at,
    }));
    for (const d of dollars(s)) {
      if (scope.renamed.has(d.ns))
        throw new ScriptError(
          `«$${d.ns}» heisst in diesem Skript «$${[...scope.aliases].find(([, v]) => v === d.ns)?.[0]}».`,
          d.at,
          where(script),
        );
      used.push({ ns: scope.aliases.get(d.ns) ?? d.ns, at: d.at });
    }
    for (const u of used) {
      if (u.ns === gameNs || u.ns === script || done.has(u.ns)) continue;
      if (visiting.includes(u.ns))
        throw new ScriptError(
          `«${u.ns}» wird im Kreis gebraucht: ${[...visiting, u.ns].join(" → ")}.`,
          u.at,
          where(script),
        );
      visit(u.ns, read(u.ns, u.at, where(script)));
    }
    visiting.pop();
    done.add(script);
  };
  visit(name, main);

  // Imports, now that every script used is read.
  const defs = new Map<string, Def & { script: string }>();
  for (const [script, s] of parsed)
    for (const d of s.defs) defs.set(`${script}:${d.name}`, { ...d, script });
  for (const [script, s] of parsed) {
    const scope = scopes.get(script) as Scope;
    const bring = (alias: string, target: string) => {
      const set = scope.imported.get(alias) ?? new Set<string>();
      set.add(target);
      scope.imported.set(alias, set);
    };
    for (const imp of s.imports) {
      if (imp.alias) continue;
      if (imp.ns === gameNs) {
        if (imp.names)
          for (const n of imp.names) {
            if (
              !library.queries[n.name] &&
              typeof library.command(n.name) === "string"
            )
              throw new ScriptError(
                `«${n.name}» gibt es im Spiel nicht.`,
                n.at,
                where(script),
              );
            scope.game.set(n.alias ?? n.name, n.name);
          }
        else scope.gameAll = true;
        continue;
      }
      const other = parsed.get(imp.ns) as Script;
      if (imp.names)
        for (const n of imp.names) {
          if (!other.defs.some((d) => d.name === n.name))
            throw new ScriptError(
              `«${n.name}» gibt es im Skript «${imp.ns}» nicht.`,
              n.at,
              where(script),
            );
          bring(n.alias ?? n.name, `${imp.ns}:${n.name}`);
        }
      else for (const d of other.defs) bring(d.name, `${imp.ns}:${d.name}`);
    }
  }

  const unit: Unit = { name, sources, main, defs, warnings: [] };
  for (const d of defs.values())
    checkBody(
      unit,
      library,
      scopes.get(d.script) as Scope,
      d.body,
      d,
      d.script,
    );
  checkBody(
    unit,
    library,
    scopes.get(name) as Scope,
    main.body,
    undefined,
    name,
  );
  return unit;
}

/** What a name resolves to before its use is checked. */
type Found =
  | { k: "def"; key: string; def: Def }
  | { k: "game"; path: string }
  | { k: "none"; hint?: string };

function checkBody(
  unit: Unit,
  library: Library,
  scope: Scope,
  body: Stmt[],
  def: (Def & { script: string }) | undefined,
  script: string,
) {
  const where = script === unit.name ? undefined : script;
  const fail = (message: string, at: Pos): never => {
    throw new ScriptError(message, at, where);
  };
  const warn = (message: string, at: Pos) => {
    if (
      !unit.warnings.some((w) => w.message === message && w.at.line === at.line)
    )
      unit.warnings.push({ message, at, script: where });
  };
  const isQuery = def?.kind === "qry";
  const vars: Set<string>[] = [new Set(def?.params ?? [])];
  const known = (n: string) => vars.some((s) => s.has(n));

  /** Whether the game has a name: a query, or a command's id or its start. */
  const gameHas = (path: string) =>
    !!library.queries[path] || typeof library.command(path) !== "string";
  /** The game's name a path stands for in this script without `$`. */
  const gamePath = (path: string): string | undefined => {
    for (const [alias, real] of scope.game)
      if (path === alias || path.startsWith(`${alias}:`))
        return real + path.slice(alias.length);
    if (scope.gameAll) return path;
    return undefined;
  };

  const find = (path: string, at: Pos): Found => {
    if (path.startsWith("$")) {
      const [first, ...rest] = path.slice(1).split(":");
      const ns = scope.aliases.get(first) ?? first;
      const inner = rest.join(":");
      if (!inner) fail(`Nach «$${first}» kommt ein Name: «$${first}:…».`, at);
      if (ns === gameNs) return { k: "game", path: inner };
      const key = `${ns}:${inner}`;
      const d = unit.defs.get(key);
      if (!d)
        return {
          k: "none",
          hint: `«${inner}» gibt es im Skript «${ns}» nicht.`,
        };
      return { k: "def", key, def: d };
    }
    const own = scope.own.get(path);
    const game = gamePath(path);
    const hides = (what: string) => {
      if (game !== undefined && gameHas(game))
        warn(
          `«${path}» ${what} verdeckt den Namen des Spiels; für den des Spiels: $${gameNs}:${game}.`,
          at,
        );
    };
    if (own) {
      hides("dieses Skripts");
      return { k: "def", key: own, def: unit.defs.get(own) as Def };
    }
    const brought = scope.imported.get(path);
    if (brought) {
      if (brought.size > 1)
        fail(
          `«${path}» kommt aus ${[...brought].map((k) => `«${k.split(":")[0]}»`).join(" und ")}: schreib $${[...brought][0].split(":")[0]}:${path} oder benenne mit «as» um.`,
          at,
        );
      const key = [...brought][0];
      hides(`aus «${key.split(":")[0]}»`);
      return { k: "def", key, def: unit.defs.get(key) as Def };
    }
    if (game !== undefined) return { k: "game", path: game };
    return {
      k: "none",
      hint: gameHas(path)
        ? `«${path}» ist ein Name des Spiels: schreib oben «import ${gameNs}» oder $${gameNs}:${path}.`
        : undefined,
    };
  };

  const unknown = (path: string, hint: string | undefined, at: Pos): never =>
    fail(
      hint ??
        (path.includes("-") &&
        path.split("-").every((p) => p && (known(p) || /^\d/.test(p)))
          ? `«${path}» ist ein Name. Zum Abziehen Leerzeichen: «${path.split("-").join(" - ")}».`
          : `«${path}» ist unbekannt.`),
      at,
    );

  const declare = (n: string, at: Pos) => {
    // No name twice, not even in an inner block: one name, one value.
    if (known(n)) fail(`«${n}» gibt es hier schon.`, at);
    const f = find(n, at);
    if (f.k === "def" || (f.k === "game" && gameHas(f.path)))
      fail(`«${n}» ist schon eine Abfrage oder ein Befehl.`, at);
    vars[vars.length - 1].add(n);
  };
  const block = (stmts: Stmt[], extra?: [string, Pos]) => {
    vars.push(new Set());
    if (extra) declare(...extra);
    for (const s of stmts) stmt(s);
    vars.pop();
  };
  const noEffect = (what: string, at: Pos) => {
    if (isQuery)
      fail(
        `${what} hat in einer Abfrage nichts verloren: «qry:${def?.name}» gibt nur einen Wert zurück und ändert nichts.`,
        at,
      );
  };
  const values = (n: number) => `${n} ${n === 1 ? "Wert" : "Werte"}`;
  const isCommand = (path: string) => typeof library.command(path) !== "string";

  /** A game command's values, checked as far as they are written out. */
  const gameArgs = (info: GameCommand, args: Expr[], at: Pos) => {
    const declared = info.args;
    const sig = `${info.id}(${declared.map((a) => a.name).join(", ")})`;
    for (const [i, seg] of info.segments.entries()) {
      const a = declared[i];
      if (a?.kind !== "choice")
        fail(`«${info.id}» nimmt seine Werte in Klammern: ${sig}.`, at);
      if (a.choices && !a.choices.includes(seg))
        fail(`«${seg}» gibt es bei «${info.id}» nicht.`, at);
    }
    const given = info.segments.length + args.length;
    if (given > declared.length)
      fail(
        declared.length
          ? `«${info.id}» nimmt ${values(declared.length)}, nicht ${given}: ${sig}.`
          : `«${info.id}» nimmt keine Werte.`,
        at,
      );
    for (let i = given; i < declared.length; i++)
      if (!declared[i].optional)
        fail(`«${info.id}» braucht ${declared[i].name}: ${sig}.`, at);
    for (const [j, e] of args.entries()) {
      const a = declared[info.segments.length + j];
      const literal =
        e.k === "num"
          ? e.v
          : e.k === "str" && e.parts.every((p) => typeof p === "string")
            ? e.parts.join("")
            : undefined;
      if (e.k === "bool" || e.k === "none" || e.k === "list")
        fail(`«${info.id}» nimmt Zahlen und Texte als Werte.`, e.at);
      if (literal === undefined) continue;
      if (a.kind === "number") {
        if (typeof literal !== "number")
          fail(
            `${a.name} ist eine Zahl, nicht ${JSON.stringify(literal)}.`,
            e.at,
          );
        else if (!Number.isInteger(literal))
          fail(`«${literal}» ist keine ganze Zahl.`, e.at);
        else if (
          (a.min !== undefined && literal < a.min) ||
          (a.max !== undefined && literal > a.max)
        )
          fail(`${a.name}: ${a.min} bis ${a.max}.`, e.at);
      } else if (a.kind === "choice" && a.choices) {
        if (!a.choices.includes(String(literal)))
          fail(`«${literal}» gibt es bei «${info.id}» nicht.`, e.at);
      }
    }
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
      case "name": {
        if (!e.name.startsWith("$") && known(e.name)) {
          e.ref = { k: "var" } satisfies Ref;
          return;
        }
        const f = find(e.name, e.at);
        if (f.k === "def") {
          if (f.def.kind === "cmd")
            fail(
              `«${e.name}» ist ein Befehl und gibt nichts zurück. Frag danach ab, was er bewirkt hat.`,
              e.at,
            );
          if (f.def.params.length)
            fail(
              `«${e.name}» ist eine Abfrage mit Werten: «${e.name}(…)».`,
              e.at,
            );
          e.ref = { k: "qry", key: f.key };
          return;
        }
        if (f.k === "game") {
          const q = library.queries[f.path];
          if (q) {
            if (q.args[0] > 0)
              fail(`«${e.name}» braucht Werte: «${e.name}(…)».`, e.at);
            e.ref = { k: "query", name: f.path };
            return;
          }
          if (isCommand(f.path))
            fail(
              `«${e.name}» ist ein Befehl und gibt nichts zurück. Frag danach ab, was er bewirkt hat.`,
              e.at,
            );
        }
        return unknown(e.name, f.k === "none" ? f.hint : undefined, e.at);
      }
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
        const f = find(e.name, e.at);
        if (f.k === "def") {
          if (f.def.kind === "cmd")
            fail(
              `«${e.name}» ist ein Befehl: er steht allein, wie «${e.name}(…)», und gibt nichts zurück.`,
              e.at,
            );
          if (f.def.params.length !== e.args.length)
            fail(`«${e.name}» braucht ${values(f.def.params.length)}.`, e.at);
          e.ref = { k: "qry", key: f.key };
          return;
        }
        if (f.k === "game") {
          const q = library.queries[f.path];
          if (q) {
            const [min, max] = q.args;
            if (e.args.length < min || e.args.length > max)
              fail(
                `«${e.name}» braucht ${min === max ? min : `${min} bis ${max}`} ${max === 1 ? "Wert" : "Werte"}.`,
                e.at,
              );
            e.ref = { k: "query", name: f.path };
            return;
          }
          if (isCommand(f.path))
            fail(
              `«${e.name}» ist ein Befehl: er steht allein, wie «${e.name}(…)», und gibt nichts zurück. Frag danach ab, was er bewirkt hat.`,
              e.at,
            );
        }
        return unknown(
          e.name,
          f.k === "none"
            ? (f.hint ?? `Die Abfrage «${e.name}» gibt es nicht.`)
            : undefined,
          e.at,
        );
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
        s.args.forEach(expr);
        const f = find(s.name, s.at);
        if (f.k === "def") {
          if (f.def.kind === "qry")
            fail(
              `«${s.name}» ist eine Abfrage: sie gibt einen Wert zurück und tut nichts. Verwende ihren Wert, wie in «var x = ${s.name}(…)».`,
              s.at,
            );
          if (f.def.params.length !== s.args.length)
            fail(
              `«${s.name}» braucht ${values(f.def.params.length)}: «${s.name}(${f.def.params.join(", ")})».`,
              s.at,
            );
          if (s.await)
            fail(
              `«await» wartet auf Befehle des Spiels; «${s.name}» wartet in sich selbst.`,
              s.at,
            );
          s.ref = { k: "cmd", key: f.key };
          return;
        }
        if (f.k === "game") {
          if (library.queries[f.path])
            fail(
              `«${s.name}» ist eine Abfrage: sie gibt einen Wert zurück und tut nichts. Verwende ihren Wert, wie in «var x = ${s.name}».`,
              s.at,
            );
          const info = library.command(f.path);
          if (typeof info === "string") fail(info, s.at);
          else {
            gameArgs(info, s.args, s.at);
            s.ref = { k: "game", id: info.id, segments: info.segments };
          }
          return;
        }
        return unknown(s.name, f.hint ?? `«${s.name}» ist kein Befehl.`, s.at);
      }
    }
  };

  for (const s of body) stmt(s);
}
