/**
 * How a command is written (ADR 0008): its id of colon segments, then its
 * values in parentheses, separated by commas: `up(15)`, `repair:under(5)`,
 * `notify:alert("Die Hütte steht.")`, `build:hütte`. A value is a number or
 * a text in double quotes, with the escapes of JSON (`\"`, `\\`). Chains
 * join commands with `;`; a `;` or `,` inside a text splits nothing. The
 * same reader serves the finder, the keymap, macros and what scripts run.
 */

/** A value as written: a number, or a text. */
export type Literal = number | string;

/** A command split into its colon segments and its values, if any. */
export interface Call {
  head: string;
  values: Literal[];
  /** Whether it was written with parentheses, even empty ones. */
  parens: boolean;
}

const limits = { text: 500, values: 16 };

/** Finds the end of a text starting at `i` (a quote); -1 if it never ends. */
function textEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === '"') return j;
  }
  return -1;
}

/**
 * Splits a chain at its `;`, outside texts and parentheses; each part with
 * where it begins. Why not, if a text or a parenthesis is left open.
 */
export function splitChain(text: string): string[] | string {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = textEnd(text, i);
      if (end < 0) return 'Ein Text ist nicht geschlossen: es fehlt ein «"».';
      i = end;
    } else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  if (depth > 0) return "Eine Klammer ist nicht geschlossen: es fehlt ein «)».";
  parts.push(text.slice(from));
  return parts;
}

/** Reads one value: a number or a text in quotes. */
export function readLiteral(raw: string): Literal | string[] {
  const t = raw.trim();
  if (!t) return ["Ein Wert fehlt zwischen den Kommas."];
  if (t.startsWith('"')) {
    if (textEnd(t, 0) !== t.length - 1)
      return [`«${t}» ist kein Text: nach dem «"» geht es nicht weiter.`];
    try {
      const s = JSON.parse(t) as unknown;
      if (typeof s !== "string") throw new Error();
      if (s.length > limits.text)
        return [`Ein Text hat höchstens ${limits.text} Zeichen.`];
      return s;
    } catch {
      return [`«${t}» ist kein gültiger Text.`];
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return [
    `«${t}» ist weder eine Zahl noch ein Text; ein Text steht in Anführungszeichen: "${t.replace(/"/g, "")}".`,
  ];
}

/** Reads the values between parentheses, separated by commas. */
export function readValues(inner: string): Literal[] | string {
  if (!inner.trim()) return [];
  const items: string[] = [];
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '"') {
      const end = textEnd(inner, i);
      if (end < 0) return 'Ein Text ist nicht geschlossen: es fehlt ein «"».';
      i = end;
    } else if (inner[i] === ",") {
      items.push(inner.slice(from, i));
      from = i + 1;
    } else if (inner[i] === "(" || inner[i] === ")")
      return "Klammern in Klammern gehen nicht; nur Zahlen und Texte.";
  }
  items.push(inner.slice(from));
  if (items.length > limits.values)
    return `Mehr als ${limits.values} Werte gehen nicht.`;
  const values: Literal[] = [];
  for (const item of items) {
    const v = readLiteral(item);
    if (Array.isArray(v)) return v[0];
    values.push(v);
  }
  return values;
}

/** Splits `id:segments(values)` into its head and its values. */
export function readCall(text: string): Call | string {
  const t = text.trim();
  if (!t) return "Leerer Befehl.";
  const open = t.indexOf("(");
  if (open < 0) {
    if (t.includes(")")) return `«${t}»: eine «)» ohne «(».`;
    if (/[\s",]/.test(t))
      return `«${t}» ist kein Befehl: Werte stehen in Klammern, wie up(15) oder notify:info("Hallo").`;
    return { head: t, values: [], parens: false };
  }
  const head = t.slice(0, open).trim();
  if (!head) return `«${t}»: vor der Klammer fehlt der Befehl.`;
  if (/[\s",]/.test(head))
    return `«${head}» ist kein Befehl: ohne Leerzeichen, wie repair:under(5).`;
  if (!t.endsWith(")")) return `«${t}»: es fehlt die «)» am Ende.`;
  // The closing parenthesis must be the last, outside texts.
  const inner = t.slice(open + 1, -1);
  const values = readValues(inner);
  if (typeof values === "string") return values;
  return { head, values, parens: true };
}

/** A value as written: numbers as they are, texts in quotes. */
export function writeLiteral(v: Literal): string {
  return typeof v === "number" ? String(v) : JSON.stringify(v);
}

/** Whether a text can stand as a colon segment, such as `hütte`. */
export function segmentSafe(v: string): boolean {
  return /^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(v);
}

/**
 * The finder's shortcut: `up 15` for `up(15)`, `rep 30` and `notify:info
 * Hallo Welt`, as the forms to try; none if the text has no space or already
 * parentheses.
 */
export function shortcut(text: string): string[] {
  const t = text.trim();
  const m = /^([^\s(]+)\s+(.+)$/.exec(t);
  if (!m || t.includes("(")) return [];
  const [, head, rest] = m;
  const words = rest.trim().split(/\s+/);
  const out = [`${head}(${rest})`];
  out.push(
    `${head}(${words.map((w) => (/^-?\d+$/.test(w) || w.startsWith('"') ? w : JSON.stringify(w))).join(", ")})`,
  );
  if (!rest.startsWith('"'))
    out.push(`${head}(${JSON.stringify(rest.trim())})`);
  return out;
}
