/**
 * The dialog «Skripte» (ADR 0007): each script with its trigger and how it
 * stands (bereit, läuft, wartet, ältere Fassung, Fehler), ▶ and ■, editing
 * and deleting it, and a new one by name. The scripts are the visitor's, the
 * same in every forest; «In diesem Wald» switches one on for the forest
 * played, and only then can it run here. A new one is switched on. Editing opens the editor
 * (scriptEditor.ts, loaded only then) with the checker's errors as they are
 * typed, «Vim-Tasten», «Speichern» and «Speichern und starten». Saving
 * leaves runs under way on the version they began with. Nodes are created
 * with the DOM API.
 */
import { slug, type Commands } from "./commands";
import { el, need } from "./dom";
import {
  editorVim,
  macroName,
  onChange,
  scripts,
  setEditorVim,
  setScript,
} from "./keymap";
import { ScriptError } from "./script/ast";
import { check, type Library } from "./script/check";
import { buildingFields } from "./script/queries";
import { describeError, type Runtime } from "./script/runtime";
import type { ScriptEditor } from "./scriptEditor";

export interface ScriptsOptions {
  root: HTMLElement;
  runtime: Runtime;
  commands: Commands;
  library: Library;
  confirm(o: { title: string; text: string; yes: string }): Promise<boolean>;
  announce(text: string): void;
}

const template = `# Ein Skript: eine Anweisung je Zeile, Befehle wie im «:».
# every 30s   ← startet es alle 30 Sekunden Spielzeit
if stock.wood >= 8 then
  await place:hütte
  say "Eine Hütte steht."
end
`;

const states: Record<string, string> = {
  idle: "bereit",
  running: "läuft",
  waiting: "wartet",
  older: "läuft, ältere Fassung",
};

export class ScriptsDialog {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private status: HTMLElement;
  /** The list's rows; refreshed on their own, so the name field keeps its focus and text. */
  private list: HTMLElement | null = null;
  private nameField: HTMLInputElement | null = null;
  /** The script being edited, its editor, and its text as saved. */
  private editing: {
    name: string;
    editor: ScriptEditor | null;
    saved: string;
  } | null = null;

  constructor(private o: ScriptsOptions) {
    this.dialog = need<HTMLDialogElement>(o.root, "[data-scripts]");
    this.body = need(this.dialog, "[data-scripts-body]");
    this.status = need(this.dialog, "[data-scripts-status]");
    o.runtime.onChange(() => this.refresh());
    onChange(() => this.refresh());
    // While the editor has focus, Escape is the editor's (vim's modes).
    this.dialog.addEventListener("cancel", (event) => {
      if (this.editing && this.body.contains(document.activeElement))
        event.preventDefault();
    });
    this.dialog.addEventListener("close", () => this.closeEditor());
    window.setInterval(() => {
      if (this.dialog.open && !this.editing) this.refresh();
    }, 1000);
  }

  open() {
    this.say("");
    if (!this.editing) this.renderList();
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.editing) this.nameField?.focus();
  }

  /** Opens the editor on a script, the dialog first. */
  edit(name: string) {
    if (!this.dialog.open) this.dialog.showModal();
    void this.openEditor(name);
  }

  private say(text: string) {
    this.status.textContent = text;
    if (text) this.o.announce(text);
  }

  /** Renews the rows, keeping the focus on the button that had it. */
  private refresh() {
    if (!this.dialog.open || this.editing || !this.list) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset
      .scriptFocus;
    this.fillList();
    if (focused) this.focusRow(focused);
  }

  private focusRow(key: string) {
    this.list
      ?.querySelector<HTMLElement>(`[data-script-focus="${CSS.escape(key)}"]`)
      ?.focus();
  }

  // --- The list ------------------------------------------------------------------------

  private renderList() {
    const input = el("input", {
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "name",
      maxLength: 60,
    });
    input.setAttribute("aria-label", "Name des neuen Skripts");
    const add = el(
      "button",
      { type: "submit", className: "wg-button wg-primary" },
      "Neues Skript",
    );
    const form = el("form", { className: "wg-scripts-new" }, input, add);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = slug(input.value);
      const why = name
        ? macroName(name)?.replace("Makroname", "Skriptname")
        : "Gib einen Namen.";
      if (why) return this.say(why);
      if (Object.hasOwn(scripts(), name))
        return this.say(`«${name}» gibt es schon.`);
      setScript(name, template);
      this.o.runtime.enable(name, true);
      void this.openEditor(name);
    });
    this.list = el("div");
    this.nameField = input;
    this.fillList();
    this.body.replaceChildren(
      el(
        "p",
        {},
        "Ein Skript führt Befehle aus wie das «:», mit Variablen, Bedingungen und Schleifen, und wartet in Spielzeit. Es startet hier, mit «:script:run:name», mit einer Taste unter «Tasten» oder mit «every» von selbst. Deine Skripte gelten für jeden Wald; laufen kann eines nur in einem Wald, in dem es eingeschaltet ist.",
      ),
      this.list,
      form,
    );
  }

  private fillList() {
    const names = Object.keys(scripts()).sort();
    this.list?.replaceChildren(
      names.length
        ? el(
            "ul",
            { className: "wg-keymap-list" },
            ...names.map((name) => this.row(name)),
          )
        : el("p", { className: "wg-keymap-none" }, "Noch keine Skripte."),
    );
  }

  private row(name: string): HTMLElement {
    const rt = this.o.runtime;
    const st = rt.state(name);
    const current = rt.current(name);
    const trigger =
      current instanceof ScriptError
        ? "Fehler im Skript"
        : current.every
          ? `every ${current.every}s`
          : "von Hand oder mit Taste";
    const on = rt.enabled(name);
    const stateText =
      st.state === "failed"
        ? `Fehler: ${describeError(st, name)}`
        : !on && st.state === "idle"
          ? "aus in diesem Wald"
          : states[st.state];
    const running =
      st.state === "running" || st.state === "waiting" || st.state === "older";
    const toggle = el(
      "button",
      { type: "button", className: "wg-button" },
      running ? "■ Anhalten" : "▶ Starten",
    );
    toggle.dataset.scriptFocus = `toggle:${name}`;
    toggle.disabled = !on && !running;
    toggle.setAttribute(
      "aria-label",
      `${running ? "Anhalten" : "Starten"}: ${name}`,
    );
    toggle.addEventListener("click", () => {
      if (running) {
        rt.stop(name);
        this.say(`«${name}» angehalten.`);
      } else {
        const why = rt.start(name);
        this.say(why ?? `«${name}» läuft.`);
      }
      this.fillList();
      this.focusRow(`toggle:${name}`);
    });
    const box = el("input", { type: "checkbox", checked: on });
    box.dataset.scriptFocus = `enable:${name}`;
    box.setAttribute("aria-label", `«${name}» in diesem Wald eingeschaltet`);
    box.addEventListener("change", () => {
      rt.enable(name, box.checked);
      this.say(
        box.checked
          ? `«${name}» ist in diesem Wald eingeschaltet.`
          : `«${name}» ist in diesem Wald ausgeschaltet${running ? " und angehalten" : ""}.`,
      );
    });
    const enable = el(
      "label",
      { className: "wg-script-on" },
      box,
      " In diesem Wald",
    );
    const edit = el(
      "button",
      { type: "button", className: "wg-button" },
      "Bearbeiten",
    );
    edit.dataset.scriptFocus = `edit:${name}`;
    edit.addEventListener("click", () => void this.openEditor(name));
    const remove = el(
      "button",
      { type: "button", className: "wg-keymap-remove" },
      "×",
    );
    remove.setAttribute("aria-label", `Skript «${name}» löschen`);
    remove.addEventListener("click", () => {
      void this.o
        .confirm({
          title: "Skript löschen?",
          text: `«${name}» wird gelöscht. Ein Lauf, der schon läuft, geht mit seiner Fassung zu Ende.`,
          yes: "Löschen",
        })
        .then((yes) => {
          if (!yes) return;
          setScript(name, null);
          this.say(`«${name}» gelöscht.`);
        });
    });
    return el(
      "li",
      { className: "wg-script-row" },
      el(
        "span",
        { className: "wg-keymap-name" },
        el("code", {}, name),
        el(
          "span",
          { className: "wg-keymap-what" },
          `${trigger} · ${stateText}`,
        ),
      ),
      enable,
      toggle,
      edit,
      remove,
    );
  }

  // --- The editor ----------------------------------------------------------------------

  /** The checker's first error for a script's text, with where it stands. */
  private problem(name: string, text: string) {
    const all = scripts();
    try {
      check(name, (n) => (n === name ? text : all[n]), this.o.library);
      return undefined;
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      // An error in an imported script is shown on the first line.
      return error.script && error.script !== name
        ? {
            message: `Im Skript «${error.script}», Zeile ${error.at.line}: ${error.message}`,
            line: 1,
            col: 1,
          }
        : { message: error.message, line: error.at.line, col: error.at.col };
    }
  }

  private async openEditor(name: string) {
    const saved = scripts()[name] ?? "";
    this.leaveList();
    this.editing = { name, editor: null, saved };
    const host = el("div", { className: "wg-script-editor" });
    // A plain field until the editor has loaded.
    const plain = el("textarea", { rows: 14, spellcheck: false, value: saved });
    plain.setAttribute("aria-label", "Quelltext des Skripts");
    host.append(plain);
    const vim = el("input", { type: "checkbox", checked: editorVim() });
    const check = el("p", { className: "wg-keymap-check" });
    const text = () => this.editing?.editor?.text ?? plain.value;
    const show = () => {
      const p = this.problem(name, text());
      check.textContent = p ? `Zeile ${p.line}: ${p.message}` : "Keine Fehler.";
      check.classList.toggle("wg-script-error", !!p);
    };
    const save = (): boolean => {
      const t = text();
      setScript(name, t);
      if (this.editing) this.editing.saved = t;
      const p = this.problem(name, t);
      this.say(
        p
          ? `«${name}» gespeichert, aber Zeile ${p.line}: ${p.message}`
          : `«${name}» gespeichert.${this.o.runtime.runs.some((r) => r.script === name) ? " Der Lauf, der schon läuft, bleibt bei seiner Fassung." : ""}`,
      );
      return !p;
    };
    const saveButton = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Speichern",
    );
    saveButton.addEventListener("click", () => void save());
    const runButton = el(
      "button",
      { type: "button", className: "wg-button" },
      "Speichern und starten",
    );
    runButton.addEventListener("click", () => {
      if (!save()) return;
      const why = this.o.runtime.start(name);
      this.say(why ?? `«${name}» gespeichert und gestartet.`);
    });
    const back = el(
      "button",
      { type: "button", className: "wg-button" },
      "Zurück zur Liste",
    );
    back.addEventListener("click", () => void this.leaveEditor());
    vim.addEventListener("change", () => {
      setEditorVim(vim.checked);
      void this.editing?.editor?.setVim(vim.checked);
      this.say(vim.checked ? "Vim-Tasten an." : "Vim-Tasten aus.");
    });
    this.body.replaceChildren(
      el("h3", {}, `Skript «${name}»`),
      el("label", { className: "wg-script-vim" }, vim, " Vim-Tasten"),
      host,
      check,
      el("div", { className: "wg-actions" }, saveButton, runButton, back),
    );
    show();
    plain.addEventListener("input", show);
    plain.focus();
    try {
      const { ScriptEditor } = await import("./scriptEditor");
      if (this.editing?.name !== name) return;
      const editor = new ScriptEditor({
        parent: host,
        text: plain.value,
        queries: Object.fromEntries(
          Object.entries(this.o.library.queries).map(([k, q]) => [
            k,
            q.describe,
          ]),
        ),
        commands: () =>
          this.o.commands
            .entries()
            .filter((e) => !this.o.commands.scriptCommand(e.text))
            .map((e) => ({ text: e.text, description: e.description })),
        fields: {
          ...buildingFields,
          wood: "Holz",
          stones: "Steine",
          bread: "Brot",
          meat: "Fleisch",
          books: "Bücher",
          x: "Waagrecht, in Feldern",
          y: "Senkrecht, in Feldern",
        },
        check: (t) => this.problem(name, t),
        changed: () => show(),
        vim: vim.checked,
      });
      plain.remove();
      this.editing.editor = editor;
      editor.focus();
    } catch {
      this.say("Der Editor liess sich nicht laden; das einfache Feld bleibt.");
    }
  }

  private async leaveEditor() {
    const e = this.editing;
    if (!e) return;
    const now =
      e.editor?.text ?? this.body.querySelector("textarea")?.value ?? e.saved;
    if (now !== e.saved) {
      const yes = await this.o.confirm({
        title: "Ungespeichert verlassen?",
        text: `Die Änderungen an «${e.name}» gehen verloren.`,
        yes: "Verwerfen",
      });
      if (!yes) return;
    }
    const name = e.name;
    this.closeEditor();
    this.renderList();
    this.focusRow(`edit:${name}`);
  }

  private closeEditor() {
    this.editing?.editor?.destroy();
    this.editing = null;
  }

  /** Leaving the list for the editor: its rows and field are gone. */
  private leaveList() {
    this.list = null;
    this.nameField = null;
  }
}
