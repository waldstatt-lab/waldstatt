/**
 * The text mode on a text read top-down, as vim's normal and visual modes:
 * a block cursor on one character moves by characters and lines (h j k l and
 * the arrows by default), by words (w, b, e), to the start (gg) or the last
 * line (G), each with a count typed before; v selects characters and V whole
 * lines, o jumps to the selection's other end, y and Ctrl+C copy it, and
 * Escape leaves the selection. Lines are the lines as they wrap on the map,
 * found from the characters' boxes, so the text's layout needs no model of
 * its own. The cursor and the selection are drawn as CSS highlights on both
 * inks of the text (overlay.ts); a browser without them shows the document
 * selection instead. The keys come from the keymap (keys.ts).
 */
import { textActionFor, type Action } from "./keys";

/** One character the text shows, where it lies in the page. */
interface Char {
  node: Text;
  offset: number;
  /** Its own character, a single space for any rendered whitespace. */
  ch: string;
  /** The block it belongs to; a new block parts words like a space. */
  block: Element;
}

type Mode = "normal" | "char" | "line";

export interface TextCursorOptions {
  /** The text's readable ink, and the copy for cobbled tiles, if any. */
  light: HTMLElement;
  dark: HTMLElement | null;
  announce(text: string): void;
  /** Brings a box on the screen into view, such as by panning the map. */
  reveal(box: DOMRect): void;
}

const blocks = "p, h1, h2, h3, h4, h5, h6, li, dt, dd, th, td, pre, blockquote";
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

export class TextCursor {
  private chars: Char[] | null = null;
  /** The dark copy's text nodes, in the same order as the light one's. */
  private darkNodes = new Map<Text, Text>();
  private caret = 0;
  private anchor = 0;
  private mode: Mode = "normal";
  /** Where j and k aim across the lines, as a share of the text's width. */
  private want: number | null = null;
  private count = 0;
  /** The first press of «gg» was made. */
  private pendingStart = false;

  constructor(private o: TextCursorOptions) {}

  /** Clears what it drew. */
  destroy() {
    if (supported) {
      CSS.highlights.delete("wg-caret");
      CSS.highlights.delete("wg-visual");
    } else if (this.chars) window.getSelection()?.removeAllRanges();
  }

  /** Whether characters are selected, for Escape and copying. */
  get selecting() {
    return this.mode !== "normal";
  }

  /** The selected text, with a line break between blocks. */
  selectedText(): string {
    const chars = this.chars;
    if (!chars || this.mode === "normal") return "";
    const [a, b] = this.span();
    let text = "";
    for (let i = a; i <= b; i++) {
      if (i > a && chars[i].block !== chars[i - 1].block) text += "\n";
      text += chars[i].ch;
    }
    return text.replace(/ +\n/g, "\n").trim();
  }

  /** Shows the cursor once the text is laid out; false until then. */
  show(): boolean {
    if (!this.build()) return false;
    this.draw();
    return true;
  }

  /**
   * A key pressed while the text mode is on; true if it was taken. Digits
   * make a count; Escape is taken only to leave a selection.
   */
  key(event: KeyboardEvent): boolean {
    if (event.key === "Escape") {
      this.count = 0;
      this.pendingStart = false;
      if (this.mode === "normal") return false;
      this.mode = "normal";
      this.draw();
      this.o.announce("Auswahl beendet.");
      return true;
    }
    if (/^[0-9]$/.test(event.key)) {
      if (event.key !== "0" || this.count)
        this.count = Math.min(9999, this.count * 10 + Number(event.key));
      return true;
    }
    const action = textActionFor(event.key);
    if (!action) {
      this.count = 0;
      this.pendingStart = false;
      return false;
    }
    if (!this.build()) return true;
    const count = this.count;
    this.count = 0;
    if (action === "textStart" && !this.pendingStart) {
      // The first «g» of «gg»; the count waits for the second.
      this.pendingStart = true;
      this.count = count;
      return true;
    }
    this.pendingStart = false;
    if (!event.repeat || action !== "textCopy") this.act(action, count);
    return true;
  }

  // --- The characters ---------------------------------------------------------

  /** Finds the characters the text shows; false while it is not laid out. */
  private build(): boolean {
    if (this.chars) return true;
    const root = this.o.light;
    if (!root.getClientRects().length) return false;
    const chars: Char[] = [];
    const range = document.createRange();
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const text = node as Text;
      const block = text.parentElement?.closest(blocks) ?? root;
      for (let i = 0; i < text.data.length; i++) {
        const ch = text.data[i];
        if (/\s/.test(ch)) {
          // Whitespace that collapses takes no room and is skipped.
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          if (!(range.getBoundingClientRect().width > 0)) continue;
          chars.push({ node: text, offset: i, ch: " ", block });
        } else chars.push({ node: text, offset: i, ch, block });
      }
    }
    if (!chars.length) return false;
    if (this.o.dark) {
      const light = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const dark = document.createTreeWalker(this.o.dark, NodeFilter.SHOW_TEXT);
      for (
        let a = light.nextNode(), b = dark.nextNode();
        a && b;
        a = light.nextNode(), b = dark.nextNode()
      )
        this.darkNodes.set(a as Text, b as Text);
    }
    this.chars = chars;
    // Not on a space: the first character that is one.
    this.caret = Math.max(
      0,
      chars.findIndex((c) => c.ch !== " "),
    );
    return true;
  }

  private box(i: number): DOMRect {
    const c = (this.chars as Char[])[i];
    const range = document.createRange();
    range.setStart(c.node, c.offset);
    range.setEnd(c.node, c.offset + 1);
    return range.getBoundingClientRect();
  }

  /** Whether two characters stand on the same line. */
  private sameLine(a: number, b: number): boolean {
    const p = this.box(a);
    const q = this.box(b);
    const middle = (r: DOMRect) => r.top + r.height / 2;
    return Math.abs(middle(p) - middle(q)) < Math.min(p.height, q.height) / 2;
  }

  /** Where a character stands across the text, from 0 to 1. */
  private across(i: number): number {
    const root = this.o.light.getBoundingClientRect();
    const box = this.box(i);
    return (box.left + box.width / 2 - root.left) / (root.width || 1);
  }

  private lineStart(i: number): number {
    while (i > 0 && this.sameLine(i - 1, i)) i--;
    return i;
  }

  private lineEnd(i: number): number {
    const n = (this.chars as Char[]).length;
    while (i < n - 1 && this.sameLine(i + 1, i)) i++;
    return i;
  }

  /** The character on the line after (+1) or before (−1) nearest `want`. */
  private lineStep(i: number, by: 1 | -1): number | null {
    const n = (this.chars as Char[]).length;
    const edge = by > 0 ? this.lineEnd(i) + 1 : this.lineStart(i) - 1;
    if (edge < 0 || edge >= n) return null;
    const from = this.lineStart(edge);
    const to = this.lineEnd(edge);
    const want = this.want ?? this.across(i);
    let best = from;
    let distance = Infinity;
    for (let j = from; j <= to; j++) {
      const d = Math.abs(this.across(j) - want);
      if (d < distance) {
        distance = d;
        best = j;
      }
    }
    return best;
  }

  // --- Words ------------------------------------------------------------------

  /** 0 for a space, 1 for a letter or digit, 2 for anything else. */
  private kind(i: number): number {
    const ch = (this.chars as Char[])[i].ch;
    if (ch === " ") return 0;
    return /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2;
  }

  /** Whether a new block starts at i, which parts words like a space. */
  private parts(i: number): boolean {
    const chars = this.chars as Char[];
    return i > 0 && chars[i].block !== chars[i - 1].block;
  }

  private wordNext(i: number): number {
    const n = (this.chars as Char[]).length;
    const k = this.kind(i);
    let j = i + 1;
    if (k) while (j < n && this.kind(j) === k && !this.parts(j)) j++;
    while (j < n && this.kind(j) === 0) j++;
    return Math.min(j, n - 1);
  }

  private wordEnd(i: number): number {
    const n = (this.chars as Char[]).length;
    let j = Math.min(i + 1, n - 1);
    while (j < n - 1 && this.kind(j) === 0) j++;
    const k = this.kind(j);
    while (j < n - 1 && this.kind(j + 1) === k && !this.parts(j + 1)) j++;
    return j;
  }

  private wordBack(i: number): number {
    let j = Math.max(i - 1, 0);
    while (j > 0 && this.kind(j) === 0) j--;
    const k = this.kind(j);
    while (j > 0 && this.kind(j - 1) === k && !this.parts(j)) j--;
    return j;
  }

  /** The word at a character, to say it. */
  private wordAt(i: number): string {
    const chars = this.chars as Char[];
    const k = this.kind(i);
    if (!k) return "Leerzeichen";
    let a = i;
    let b = i;
    while (a > 0 && this.kind(a - 1) === k && !this.parts(a)) a--;
    while (b < chars.length - 1 && this.kind(b + 1) === k && !this.parts(b + 1))
      b++;
    return chars
      .slice(a, b + 1)
      .map((c) => c.ch)
      .join("");
  }

  private lineText(i: number): string {
    const chars = this.chars as Char[];
    return chars
      .slice(this.lineStart(i), this.lineEnd(i) + 1)
      .map((c) => c.ch)
      .join("")
      .trim();
  }

  // --- Actions ----------------------------------------------------------------

  private act(action: Action, count: number) {
    const chars = this.chars as Char[];
    const times = Math.max(1, count);
    let at = this.caret;
    let say: "word" | "line" | "" = "";
    const repeat = (step: (i: number) => number | null) => {
      for (let t = 0; t < times; t++) {
        const next = step(at);
        if (next === null || next === at) break;
        at = next;
      }
    };
    switch (action) {
      case "textLeft":
        repeat((i) => (i > 0 && this.sameLine(i - 1, i) ? i - 1 : null));
        this.want = null;
        break;
      case "textRight":
        repeat((i) =>
          i < chars.length - 1 && this.sameLine(i + 1, i) ? i + 1 : null,
        );
        this.want = null;
        break;
      case "textDown":
      case "textUp":
        this.want ??= this.across(at);
        repeat((i) => this.lineStep(i, action === "textDown" ? 1 : -1));
        say = "line";
        break;
      case "wordNext":
        repeat((i) => this.wordNext(i));
        this.want = null;
        say = "word";
        break;
      case "wordEnd":
        repeat((i) => this.wordEnd(i));
        this.want = null;
        say = "word";
        break;
      case "wordBack":
        repeat((i) => this.wordBack(i));
        this.want = null;
        say = "word";
        break;
      case "textStart":
      case "textEnd": {
        // With a count, to that line, as «5gg» and «5G» in vim.
        if (count) {
          at = 0;
          for (let t = 1; t < count; t++) {
            const next = this.lineStep(at, 1);
            if (next === null) break;
            at = next;
          }
          at = this.lineStart(at);
        } else
          at = action === "textStart" ? 0 : this.lineStart(chars.length - 1);
        while (at < chars.length - 1 && chars[at].ch === " ") at++;
        this.want = null;
        say = "line";
        break;
      }
      case "textVisual":
      case "textVisualLine": {
        const mode = action === "textVisual" ? "char" : "line";
        if (this.mode === mode) {
          this.mode = "normal";
          this.o.announce("Auswahl beendet.");
        } else {
          if (this.mode === "normal") this.anchor = at;
          this.mode = mode;
          this.o.announce(
            mode === "char" ? "Zeichen auswählen." : "Zeilen auswählen.",
          );
        }
        break;
      }
      case "textOther":
        if (this.mode !== "normal") {
          [this.anchor, at] = [at, this.anchor];
          this.want = null;
        }
        break;
      case "textCopy":
        if (this.mode !== "normal") {
          const text = this.selectedText();
          void navigator.clipboard?.writeText(text).then(
            () => this.o.announce("Kopiert."),
            () => this.o.announce("Der Browser lässt nicht kopieren."),
          );
          // As vim's y: back to the start of the selection.
          at = this.span()[0];
          this.mode = "normal";
        }
        break;
      default:
        return;
    }
    this.caret = at;
    this.draw();
    this.o.reveal(this.box(at));
    if (say === "word") this.o.announce(this.wordAt(at));
    else if (say === "line") this.o.announce(this.lineText(at));
  }

  /** The selected characters, first and last. */
  private span(): [number, number] {
    let a = Math.min(this.anchor, this.caret);
    let b = Math.max(this.anchor, this.caret);
    if (this.mode === "line") {
      a = this.lineStart(a);
      b = this.lineEnd(b);
    }
    return [a, b];
  }

  // --- Drawing ----------------------------------------------------------------

  /** Ranges over characters a to b, in the light ink and the dark copy. */
  private ranges(a: number, b: number): Range[] {
    const chars = this.chars as Char[];
    const make = (map: (t: Text) => Text | undefined) => {
      const start = map(chars[a].node);
      const end = map(chars[b].node);
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start, chars[a].offset);
      range.setEnd(end, chars[b].offset + 1);
      return range;
    };
    return [make((t) => t), make((t) => this.darkNodes.get(t))].filter(
      (r): r is Range => r !== null,
    );
  }

  private draw() {
    if (!this.chars) return;
    const caret = this.ranges(this.caret, this.caret);
    const visual = this.mode === "normal" ? [] : this.ranges(...this.span());
    if (supported) {
      const mark = new Highlight(...caret);
      // The cursor shows over the selection.
      mark.priority = 1;
      CSS.highlights.set("wg-caret", mark);
      CSS.highlights.set("wg-visual", new Highlight(...visual));
      return;
    }
    // Without highlights, the document selection shows where the cursor is.
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const shown = (visual.length ? visual : caret)[0];
    if (shown) selection?.addRange(shown);
  }
}
