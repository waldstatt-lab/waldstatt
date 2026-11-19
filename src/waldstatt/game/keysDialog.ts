/**
 * The dialog «Tasten» from the menu and the «:» finder (ADR 0006): lists the
 * bindings in force by context, each with its keys, its command and what it
 * does, and × to remove it. «+ Bindung» records a key or a sequence of keys,
 * takes a command or a chain of commands joined by «;», checked as it is
 * typed, and a context; a key already bound there asks first. The macros
 * are listed with their steps, to edit, add or delete. The visitor's own
 * bindings and macros can be edited as JSON, downloaded as a file and read
 * back from one; what is read is checked and its problems are listed with
 * their lines. «Standard» brings the default bindings back after asking.
 * Every change is kept at once (keymap.ts). Nodes are created with the DOM
 * API.
 */
import { contexts, slug, type Commands } from "./commands";
import {
  bind,
  effective,
  isModifier,
  keyLabel,
  keyName,
  keySpoken,
  macroName,
  macros,
  onChange,
  readContext,
  readJson,
  reset,
  resolve,
  setMacro,
  setUserKeymap,
  toJson,
  unbind,
  type Binding,
} from "./keymap";

export interface KeysOptions {
  root: HTMLElement;
  commands: Commands;
  confirm(o: { title: string; text: string; yes: string }): Promise<boolean>;
  announce(text: string): void;
}

function need<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

const contextNames: Record<string, string> = {
  map: "Überall auf der Karte",
  "map && !text": "Auf der Karte, nicht im Text",
  placing: "Beim Platzieren",
  reading: "In der Ansicht von oben",
  text: "Im Text, von oben gelesen",
  card: "Auf der Karte eines Gebäudes",
};

export class KeysDialog {
  private dialog: HTMLDialogElement;
  private list: HTMLElement;
  private status: HTMLElement;
  /** The keys recorded for a new binding, while recording or after. */
  private recorded: string[] = [];
  private recording = false;
  /** A key taken while recording: its release must not press a button. */
  private taken: string | null = null;
  private form: {
    keys: HTMLButtonElement;
    done: HTMLButtonElement;
    command: HTMLInputElement;
    context: HTMLInputElement;
    check: HTMLElement;
  } | null = null;
  private json: {
    text: HTMLTextAreaElement;
    problems: HTMLElement;
  } | null = null;

  constructor(private o: KeysOptions) {
    this.dialog = need<HTMLDialogElement>(o.root, "[data-keys]");
    this.list = need(this.dialog, "[data-keys-list]");
    this.status = need(this.dialog, "[data-keys-status]");
    need(this.dialog, "[data-keys-reset]").addEventListener(
      "click",
      () => void this.restore(),
    );
    // Before the dialog's own Escape, and before anything else hears the key.
    this.dialog.addEventListener("keydown", (event) => this.key(event), {
      capture: true,
    });
    this.dialog.addEventListener(
      "keyup",
      (event) => {
        if (event.key !== this.taken) return;
        this.taken = null;
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true },
    );
    this.dialog.addEventListener("close", () => this.stopRecording());
    onChange(() => {
      if (this.dialog.open) this.renderLists();
    });
  }

  open() {
    this.say("");
    this.render();
    if (this.dialog.open) return;
    this.dialog.showModal();
    // Not onto a ×, where a stray Enter would remove a key.
    this.form?.keys.focus();
  }

  /** Says what happened, in the dialog and to screen readers. */
  private say(text: string) {
    this.status.textContent = text;
    if (text) this.o.announce(text);
  }

  // --- Building the dialog ------------------------------------------------------------

  private render() {
    this.list.replaceChildren(
      this.addForm(),
      el("div", { className: "wg-keymap-bindings" }),
      el("div", { className: "wg-keymap-macros" }),
      this.jsonPart(),
    );
    this.renderLists();
  }

  /** The bindings and the macros, again after each change. */
  private renderLists() {
    const bindings = this.list.querySelector(".wg-keymap-bindings");
    const macroList = this.list.querySelector(".wg-keymap-macros");
    if (!bindings || !macroList) return this.render();
    const focused = (document.activeElement as HTMLElement | null)?.dataset
      .keysFocus;
    const byContext = new Map<string, Binding[]>();
    for (const b of effective()) {
      const list = byContext.get(b.context) ?? [];
      list.push(b);
      byContext.set(b.context, list);
    }
    bindings.replaceChildren(
      ...[...byContext].map(([context, list]) =>
        el(
          "section",
          {},
          el("h3", {}, contextNames[context] ?? `Kontext «${context}»`),
          el(
            "ul",
            { className: "wg-keymap-list" },
            ...list.map((b, i) => this.bindingRow(b, `${context}:${i}`)),
          ),
        ),
      ),
    );
    macroList.replaceChildren(this.macroPart());
    if (focused)
      this.list
        .querySelector<HTMLElement>(
          `[data-keys-focus="${CSS.escape(focused)}"]`,
        )
        ?.focus();
  }

  private bindingRow(b: Binding, id: string): HTMLElement {
    const parsed = this.o.commands.parse(b.command ?? "");
    const description =
      "error" in parsed ? parsed.error : this.o.commands.describe(parsed.steps);
    const remove = el(
      "button",
      { type: "button", className: "wg-keymap-remove" },
      "×",
    );
    remove.dataset.keysFocus = id;
    remove.setAttribute(
      "aria-label",
      `«${keySpoken(b.keys)}» für «${b.command}» entfernen`,
    );
    remove.addEventListener("click", () => {
      unbind(b);
      this.say(`«${keyLabel(b.keys)}» für «${b.command}» entfernt.`);
    });
    return el(
      "li",
      { className: "wg-keymap-row" },
      el("kbd", { className: "wg-keymap-keys" }, keyLabel(b.keys)),
      el(
        "span",
        { className: "wg-keymap-name" },
        el("code", {}, b.command ?? ""),
        el("span", { className: "wg-keymap-what" }, description),
      ),
      remove,
    );
  }

  /** «+ Bindung»: keys, then a command or chain, then a context. */
  private addForm(): HTMLElement {
    const keys = el("button", { type: "button", className: "wg-button" });
    const done = el(
      "button",
      { type: "button", className: "wg-button" },
      "Fertig",
    );
    done.hidden = true;
    const command = el("input", {
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: "z. B. build:hütte;enter;right(3)",
    });
    command.setAttribute("list", "wg-keymap-commands");
    const options = el("datalist", { id: "wg-keymap-commands" });
    options.append(
      ...this.o.commands
        .entries()
        .slice(0, 400)
        .map((e) => el("option", { value: e.text, label: e.description })),
    );
    const context = el("input", {
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      value: "map",
    });
    context.setAttribute("list", "wg-keymap-contexts");
    const contextOptions = el("datalist", { id: "wg-keymap-contexts" });
    contextOptions.append(
      ...[...contexts, "map && !text"].map((c) =>
        el("option", { value: c, label: contextNames[c] ?? c }),
      ),
    );
    const check = el("p", { className: "wg-keymap-check" });
    const save = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Bindung speichern",
    );
    this.form = { keys, done, command, context, check };
    this.showRecorded();
    keys.addEventListener("click", () => {
      if (this.recording) return this.stopRecording(true);
      this.recorded = [];
      this.recording = true;
      this.showRecorded();
      this.say(
        "Drücke die Taste, oder mehrere nacheinander wie «g g»; dann «Fertig». Escape bricht ab.",
      );
    });
    done.addEventListener("click", () => this.stopRecording(true));
    command.addEventListener("input", () => this.checkForm());
    context.addEventListener("input", () => this.checkForm());
    save.addEventListener("click", () => void this.saveBinding());
    return el(
      "section",
      { className: "wg-keymap-add" },
      el("h3", {}, "+ Bindung"),
      el("div", { className: "wg-keymap-record" }, keys, done),
      el(
        "label",
        { className: "wg-field" },
        "Befehl, oder mehrere mit «;»",
        command,
        options,
      ),
      el(
        "label",
        { className: "wg-field" },
        "Kontext: map, placing, reading, text, card, verbunden mit && || !",
        context,
        contextOptions,
      ),
      check,
      save,
    );
  }

  private showRecorded() {
    const f = this.form;
    if (!f) return;
    f.keys.textContent = this.recording
      ? this.recorded.length
        ? `${keyLabel(this.recorded)} …`
        : "Taste drücken …"
      : this.recorded.length
        ? `Tasten: ${keyLabel(this.recorded)}`
        : "Tasten aufnehmen";
    f.keys.setAttribute("aria-pressed", String(this.recording));
    f.done.hidden = !this.recording;
    this.checkForm();
  }

  private stopRecording(say = false) {
    if (!this.recording) return;
    this.recording = false;
    this.showRecorded();
    if (say)
      this.say(
        this.recorded.length
          ? `Aufgenommen: ${keySpoken(this.recorded)}.`
          : "Keine Taste aufgenommen.",
      );
    this.form?.command.focus();
  }

  /** Checks the form as it is filled: what the command does, or why not. */
  private checkForm(): boolean {
    const f = this.form;
    if (!f) return false;
    const context = readContext(f.context.value);
    let text: string;
    let ok = false;
    if (!f.command.value.trim()) text = "";
    else {
      const parsed = this.o.commands.parse(f.command.value);
      if ("error" in parsed)
        text =
          parsed.step > 1
            ? `Schritt ${parsed.step}: ${parsed.error}`
            : parsed.error;
      else if (typeof context === "string") text = context;
      else {
        text = this.o.commands.describe(parsed.steps);
        ok = this.recorded.length > 0;
      }
    }
    f.check.textContent = text;
    return ok;
  }

  private async saveBinding() {
    const f = this.form;
    if (!f) return;
    if (!this.recorded.length) return this.say("Zuerst die Tasten aufnehmen.");
    if (!this.checkForm())
      return this.say(f.check.textContent || "Gib einen Befehl ein.");
    const context = f.context.value.trim();
    const command = f.command.value
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(";");
    const read = readContext(context);
    if (typeof read === "string") return this.say(read);
    // What the keys do there now, if anything.
    const now = effective().find(
      (b) =>
        b.context === context && b.keys.join(" ") === this.recorded.join(" "),
    );
    if (now && now.command !== command) {
      const yes = await this.o.confirm({
        title: "Taste ersetzen?",
        text: `«${keyLabel(this.recorded)}» führt hier schon «${now.command}» aus.`,
        yes: "Ersetzen",
      });
      if (!yes) return;
    }
    bind(this.recorded, context, command);
    // A longer sequence beginning with these keys makes them wait.
    const waits = resolve(this.recorded, new Set(contexts)).longer;
    this.say(
      `«${keyLabel(this.recorded)}» führt jetzt «${command}» aus.${waits ? " Eine längere Folge beginnt gleich: nach dieser Taste wird kurz gewartet." : ""}`,
    );
    this.recorded = [];
    f.command.value = "";
    this.showRecorded();
  }

  /** The macros: each with its steps to edit and ×, and one to add. */
  private macroPart(): HTMLElement {
    const all = Object.entries(macros());
    const row = (name: string, steps: string, isNew = false) => {
      const nameInput = el("input", {
        type: "text",
        value: name,
        autocomplete: "off",
        spellcheck: false,
        placeholder: "name",
      });
      nameInput.readOnly = !isNew;
      nameInput.setAttribute("aria-label", "Name des Makros");
      const stepsInput = el("input", {
        type: "text",
        value: steps,
        autocomplete: "off",
        spellcheck: false,
        placeholder:
          "tool:holzhacken;selection:start;up(10);right(10);selection:confirm",
      });
      stepsInput.setAttribute("aria-label", `Schritte von «${name || "neu"}»`);
      stepsInput.dataset.keysFocus = `macro:${name}`;
      const save = el(
        "button",
        { type: "button", className: "wg-button" },
        isNew ? "Hinzufügen" : "Speichern",
      );
      save.addEventListener("click", () => {
        const n = slug(nameInput.value);
        const why = n ? macroName(n) : "Gib einen Namen.";
        if (why) return this.say(why);
        const parsed = this.o.commands.parse(stepsInput.value);
        if ("error" in parsed)
          return this.say(`Schritt ${parsed.step}: ${parsed.error}`);
        setMacro(n, parsed.steps.map((s) => s.text).join(";"));
        this.say(`Makro «${n}» gespeichert: :macro:run:${n}`);
      });
      const parts: HTMLElement[] = [nameInput, stepsInput, save];
      if (!isNew) {
        const remove = el(
          "button",
          { type: "button", className: "wg-keymap-remove" },
          "×",
        );
        remove.setAttribute("aria-label", `Makro «${name}» löschen`);
        remove.addEventListener("click", () => {
          setMacro(name, null);
          this.say(`Makro «${name}» gelöscht.`);
        });
        parts.push(remove);
      }
      return el("li", { className: "wg-keymap-macro" }, ...parts);
    };
    return el(
      "section",
      {},
      el("h3", {}, "Makros"),
      el(
        "p",
        {},
        "Ein Makro führt Befehle nacheinander aus; eine Zahl davor wiederholt es. Es läuft mit «:macro:run:name» und lässt sich wie ein Befehl binden.",
      ),
      el(
        "ul",
        { className: "wg-keymap-list" },
        ...all.map(([name, steps]) => row(name, steps)),
        row("", "", true),
      ),
    );
  }

  /** The visitor's bindings and macros as JSON, and as a file. */
  private jsonPart(): HTMLElement {
    const text = el("textarea", { rows: 12, spellcheck: false });
    text.setAttribute("aria-label", "Eigene Bindungen und Makros als JSON");
    const problems = el("ul", { className: "wg-keymap-problems" });
    this.json = { text, problems };
    const apply = el(
      "button",
      { type: "button", className: "wg-button wg-primary" },
      "Übernehmen",
    );
    apply.addEventListener("click", () => this.applyJson(text.value));
    const download = el(
      "button",
      { type: "button", className: "wg-button" },
      "Herunterladen",
    );
    download.addEventListener("click", () => {
      const blob = new Blob([toJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: "waldstatt-tasten.json" });
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.say("Die Tasten werden heruntergeladen.");
    });
    const file = el("input", {
      type: "file",
      accept: "application/json,.json",
    });
    file.hidden = true;
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      if (f.size > 500_000) return this.say("Die Datei ist zu gross.");
      void f.text().then((content) => {
        text.value = content;
        this.say("Datei gelesen. Prüfe sie und wähle «Übernehmen».");
        this.problems(readJson(content, this.why).problems);
      });
    });
    const fromFile = el(
      "button",
      { type: "button", className: "wg-button" },
      "Aus Datei …",
    );
    fromFile.addEventListener("click", () => file.click());
    const details = el(
      "details",
      { className: "wg-keymap-json" },
      el("summary", {}, "Als JSON bearbeiten"),
      el(
        "p",
        {},
        "Eigene Bindungen über dem Standard, nach Kontext; null nimmt eine Standardtaste weg.",
      ),
      text,
      problems,
      el("div", { className: "wg-actions" }, apply, download, fromFile, file),
    );
    details.addEventListener("toggle", () => {
      if (details.open) {
        text.value = toJson();
        problems.replaceChildren();
      }
    });
    return details;
  }

  private why = (text: string) => this.o.commands.check(text);

  private problems(list: { text: string; line?: number }[]) {
    this.json?.problems.replaceChildren(
      ...list.map((p) =>
        el("li", {}, p.line ? `Zeile ${p.line}: ${p.text}` : p.text),
      ),
    );
  }

  private applyJson(text: string) {
    const { keymap, problems } = readJson(text, this.why);
    this.problems(problems);
    if (problems.length)
      return this.say(
        `${problems.length === 1 ? "Ein Fehler" : `${problems.length} Fehler`}: nichts übernommen.`,
      );
    setUserKeymap(keymap);
    this.say("Tasten und Makros übernommen.");
  }

  // --- Keys while recording -------------------------------------------------------------

  /** The keys pressed while a binding's keys are recorded. */
  private key(event: KeyboardEvent) {
    if (!this.recording || isModifier(event.key)) return;
    // Tab moves on as always, to «Fertig».
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    this.taken = event.key;
    if (event.key === "Escape") {
      this.recorded = [];
      return this.stopRecording(true);
    }
    if (event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey)
      return this.say("Nur Tasten ohne Strg, Alt oder Cmd.");
    const name = keyName(event);
    if (!name) return;
    if (/^[0-9]$/.test(name))
      return this.say("Ziffern sind für Zahlen vor einer Taste.");
    if (this.recorded.length >= 4) return this.stopRecording(true);
    this.recorded.push(name);
    this.showRecorded();
    this.say(`${keySpoken(this.recorded)}.`);
  }

  private async restore() {
    this.stopRecording();
    const yes = await this.o.confirm({
      title: "Standardtasten?",
      text: "Alle Bindungen werden wieder wie am Anfang: Pfeile, h j k l und s e i u bewegen, a wählt Holzhacken, r Reparieren, q nimmt ein Makro auf. Deine Bindungen gehen verloren; die Makros bleiben.",
      yes: "Standard",
    });
    if (!yes) return;
    reset();
    this.say("Die Standardtasten gelten wieder.");
  }
}
