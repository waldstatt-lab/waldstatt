/**
 * The script editor (ADR 0007): CodeMirror 6 with a mode for the Waldstatt's
 * script language, completion of keywords, the game's queries and commands
 * (with their German descriptions), the script's own `cmd:` and `qry:`, and
 * the fields after a dot, and the checker's errors marked where they stand
 * as the text is typed. Vim's keys come from `@replit/codemirror-vim`,
 * loaded only when they are switched on. This module is loaded only when
 * the editor opens (scriptsDialog.ts), so the game's own script does not
 * carry it.
 */
import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { scriptKeywords } from "./script/parse";

export interface EditorOptions {
  parent: HTMLElement;
  text: string;
  /** Completions: the game's queries, commands and the fields after a dot. */
  queries: Record<string, string>;
  commands: () => { text: string; description: string }[];
  fields: Record<string, string>;
  /** The checker's error for the text, with its line and column, if any. */
  check(
    text: string,
  ): { message: string; line: number; col: number } | undefined;
  changed(text: string): void;
  vim: boolean;
}

/** Highlighting for the language: keywords, commands, texts, numbers, comments. */
const mode = StreamLanguage.define<{ start: boolean }>({
  startState: () => ({ start: true }),
  token(stream, state) {
    if (stream.sol()) state.start = true;
    if (stream.eatSpace()) return null;
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"(?:[^"]|\{[^}]*\})*"?/)) return "string";
    if (stream.match(/^\d+(?:\.\d+)?[smh]?(?![\p{L}_])/u)) return "number";
    if (stream.match(/^(?:cmd|qry):[\p{L}_][\p{L}\p{N}_-]*/u)) {
      state.start = false;
      return "definition";
    }
    const word = stream.match(
      /^[\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*/u,
    ) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      const wasStart = state.start;
      state.start = false;
      if (scriptKeywords.includes(w)) {
        if (w === "await" || w === "else" || w === "then" || w === "do")
          state.start = w === "await";
        return w === "true" || w === "false" || w === "none"
          ? "atom"
          : "keyword";
      }
      // A command: a word at the start of a statement, with its colons.
      if (
        wasStart &&
        (stream.peek() === ":" ||
          stream.eol() ||
          /[\s;]/.test(stream.peek() ?? ""))
      ) {
        stream.match(/^(?::[\p{L}\p{N}_-]*|:\{[^}]*\})*/u);
        return "command";
      }
      return "variableName";
    }
    if (stream.match(";")) {
      state.start = true;
      return "punctuation";
    }
    stream.next();
    return "operator";
  },
  tokenTable: {
    command: tags.function(tags.variableName),
    definition: tags.definition(tags.function(tags.variableName)),
  },
});

const style = HighlightStyle.define([
  { tag: tags.keyword, color: "#f0b65a", fontWeight: "700" },
  { tag: tags.comment, color: "#9aa08c", fontStyle: "italic" },
  { tag: tags.string, color: "#b9dc8a" },
  { tag: tags.number, color: "#8cc8e8" },
  { tag: tags.atom, color: "#8cc8e8" },
  { tag: tags.function(tags.variableName), color: "#8fd3c4" },
  {
    tag: tags.definition(tags.function(tags.variableName)),
    color: "#ffcf7a",
    fontWeight: "700",
  },
]);

const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#2b2016",
      color: "#f1e6cf",
      fontSize: "0.9rem",
      border: "2px solid #6b4a2b",
      borderRadius: "0.25rem",
      minHeight: "16rem",
      maxHeight: "60vh",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, monospace",
      fontVariantLigatures: "none",
      overflow: "auto",
    },
    ".cm-content": { caretColor: "#ffcf7a" },
    ".cm-gutters": {
      backgroundColor: "#241a11",
      color: "#8a7a62",
      border: "none",
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#ffcf7a" },
    "&.cm-focused": { outline: "3px solid #e3b04b" },
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: "#7a5a32",
      },
    ".cm-tooltip": {
      backgroundColor: "#3a2a1c",
      color: "#f1e6cf",
      border: "1px solid #6b4a2b",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "#6b4a2b",
      color: "#fff",
    },
    ".cm-completionDetail": {
      color: "#c8b898",
      fontStyle: "normal",
      marginLeft: "0.6em",
    },
    ".cm-fat-cursor": { background: "#ffcf7a", color: "#2b2016" },
  },
  { dark: true },
);

export class ScriptEditor {
  private view: EditorView;
  private vim = new Compartment();

  constructor(o: EditorOptions) {
    const words = /[\p{L}\p{N}_:-]*/u;
    const complete = (context: CompletionContext) => {
      // Fields after a dot.
      const field = context.matchBefore(/\.[\p{L}_]*$/u);
      if (field) {
        return {
          from: field.from + 1,
          options: Object.entries(o.fields).map(
            ([label, detail]): Completion => ({
              label,
              detail,
              type: "property",
            }),
          ),
        };
      }
      const word = context.matchBefore(/[\p{L}_][\p{L}\p{N}_:-]*$/u);
      if (!word && !context.explicit) return null;
      const from = word ? word.from : context.pos;
      const text = context.state.doc.toString();
      const own = [
        ...text.matchAll(/^(cmd|qry):([\p{L}_][\p{L}\p{N}_-]*)\(([^)]*)\)/gmu),
      ].map((m): Completion => ({
        label: m[1] === "cmd" ? `${m[2]}:` : `${m[2]}(`,
        detail: `${m[1] === "cmd" ? "Befehl" : "Abfrage"} des Skripts (${m[3]})`,
        type: m[1] === "cmd" ? "function" : "method",
      }));
      const options: Completion[] = [
        ...scriptKeywords.map((k): Completion => ({
          label: k,
          type: "keyword",
        })),
        ...Object.entries(o.queries).map(([label, detail]): Completion => ({
          label,
          detail,
          type: "variable",
        })),
        ...own,
        ...o.commands().map((c): Completion => ({
          label: c.text,
          detail: c.description,
          type: "function",
        })),
      ];
      return { from, options, validFor: words };
    };
    const lint = linter(
      (view): Diagnostic[] => {
        const e = o.check(view.state.doc.toString());
        if (!e) return [];
        const doc = view.state.doc;
        const line = doc.line(Math.min(Math.max(1, e.line), doc.lines));
        const from = Math.min(line.from + Math.max(0, e.col - 1), line.to);
        // From the column to the end of the line, or the line if it is empty there.
        const to = from < line.to ? line.to : Math.min(doc.length, from + 1);
        return [
          {
            from: Math.min(from, to),
            to,
            severity: "error",
            message: e.message,
          },
        ];
      },
      { delay: 300 },
    );
    const extensions: Extension[] = [
      this.vim.of([]),
      lineNumbers(),
      // Vim's keys hide the browser's selection; this draws it, visual mode too.
      drawSelection(),
      history(),
      mode,
      syntaxHighlighting(style),
      theme,
      autocompletion({ override: [complete], activateOnTyping: true }),
      lint,
      keymap.of([
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) o.changed(u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({
        "aria-label": "Quelltext des Skripts",
      }),
    ];
    this.view = new EditorView({
      state: EditorState.create({ doc: o.text, extensions }),
      parent: o.parent,
    });
    if (o.vim) void this.setVim(true);
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  focus() {
    this.view.focus();
  }

  /** Switches vim's keys on or off; they load the first time. */
  async setVim(on: boolean) {
    if (!on) {
      this.view.dispatch({ effects: this.vim.reconfigure([]) });
      return;
    }
    const { vim } = await import("@replit/codemirror-vim");
    this.view.dispatch({ effects: this.vim.reconfigure(vim()) });
  }

  destroy() {
    this.view.destroy();
  }
}
