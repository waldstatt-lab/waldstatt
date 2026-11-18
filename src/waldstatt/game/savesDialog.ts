/**
 * The dialog «Wälder» from the menu (ADR 0004): saves the forest being played
 * under a name, lists the saved forests to load, download or delete, offers
 * the forest being played as a file, and adds a forest from a file to the
 * list. Loading replaces the forest being played and asks first, as do
 * overwriting and deleting. The same actions are commands in the «:» finder;
 * each opens the dialog, so what happens shows there. Nodes are created with the DOM API; names are
 * set as text, never as HTML.
 */
import {
  cleanName,
  download,
  get,
  list,
  put,
  remove,
  upload,
  type Entry,
} from "./saves";
import type { Saved } from "./state";

export interface SavesOptions {
  root: HTMLElement;
  /** The forest being played. */
  state: Saved;
  gameIds: Set<string>;
  confirm(o: { title: string; text: string; yes: string }): Promise<boolean>;
  announce(text: string): void;
  /** Replaces the forest being played with another and starts it. */
  replace(next: Saved): Promise<void>;
}

function need<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const when = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const short = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
});

const replaceText =
  "Der Wald, in dem du jetzt bist, wird ersetzt. Speichere ihn zuerst unter einem Namen, wenn du ihn behalten willst.";

export class SavesDialog {
  private dialog: HTMLDialogElement;
  private form: HTMLFormElement;
  private name: HTMLInputElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private status: HTMLElement;
  private file: HTMLInputElement;
  private entries: Entry[] = [];
  /** Set while something is written or read, so nothing runs twice. */
  private busy = false;

  constructor(private o: SavesOptions) {
    this.dialog = need<HTMLDialogElement>(o.root, "[data-saves]");
    this.form = need<HTMLFormElement>(this.dialog, "[data-saves-form]");
    this.name = need<HTMLInputElement>(this.dialog, "[data-saves-name]");
    this.list = need(this.dialog, "[data-saves-list]");
    this.empty = need(this.dialog, "[data-saves-empty]");
    this.status = need(this.dialog, "[data-saves-status]");
    this.file = need<HTMLInputElement>(this.dialog, "[data-saves-file]");

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveAs();
    });
    this.name.addEventListener("input", () => this.name.setCustomValidity(""));
    need(this.dialog, "[data-saves-export]").addEventListener("click", () =>
      this.downloadCurrent(),
    );
    need(this.dialog, "[data-saves-import]").addEventListener("click", () =>
      this.file.click(),
    );
    this.file.addEventListener("change", () => {
      const file = this.file.files?.[0];
      this.file.value = "";
      if (file) void this.fromFile(file);
    });
    // The finder lists the saved forests before the dialog first opens.
    void this.refresh(true);
  }

  /** Opens the dialog with the saved forests listed. */
  open(): Promise<void> {
    this.say("");
    this.name.setCustomValidity("");
    if (!this.dialog.open) this.dialog.showModal();
    return this.refresh();
  }

  /**
   * Commands for the «:» finder, as its buttons do: save, download, read a
   * file, and load, download or delete each saved forest. Each opens the
   * dialog first.
   */
  commands(): { label: string; hint?: string; run(): void }[] {
    const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");
    const then = (run: () => unknown) => () => {
      void this.open().then(run);
    };
    return [
      {
        label: "wald:speichern",
        hint: "unter einem Namen",
        run: () => {
          void this.open();
          this.name.focus();
        },
      },
      {
        label: "wald:herunterladen",
        hint: "diesen Wald als Datei",
        run: then(() => this.downloadCurrent()),
      },
      {
        label: "wald:aus-datei",
        hint: "einen Wald aus einer Datei",
        // The file picker opens only straight from the key or tap.
        run: () => {
          void this.open();
          this.file.click();
        },
      },
      ...this.entries.flatMap((e) => {
        const hint = `gespeichert ${short.format(e.at)}`;
        return [
          {
            label: `wald:laden:${slug(e.name)}`,
            hint,
            run: then(() => this.load(e.name)),
          },
          {
            label: `wald:herunterladen:${slug(e.name)}`,
            hint,
            run: then(() => this.downloadSaved(e.name)),
          },
          {
            label: `wald:löschen:${slug(e.name)}`,
            hint,
            run: then(() => this.delete(e.name)),
          },
        ];
      }),
    ];
  }

  private downloadCurrent() {
    download(cleanName(this.name.value) || "Waldstatt", this.o.state);
    this.say("Der Wald wird heruntergeladen.");
  }

  /** When a saved forest was saved, and how large it is. */
  private details(entry: Entry): string {
    return [
      when.format(entry.at),
      `${entry.people} ${entry.people === 1 ? "Waldmensch" : "Waldleute"}`,
      `${entry.buildings} Gebäude`,
    ].join(" · ");
  }

  /** Says what happened, in the dialog and to screen readers. */
  private say(text: string) {
    this.status.textContent = text;
    if (text) this.o.announce(text);
  }

  /** Runs one task at a time; a failure is said with the given words. */
  private async task(failed: string, run: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try {
      await run();
    } catch {
      this.say(failed);
    } finally {
      this.busy = false;
    }
  }

  /** Lists the saved forests again; quiet at the start, where nobody asked. */
  private async refresh(quiet = false) {
    try {
      this.entries = await list();
    } catch {
      this.entries = [];
      if (!quiet) this.say("Der Browser lässt keine Wälder speichern.");
    }
    this.list.replaceChildren(...this.entries.map((e) => this.item(e)));
    this.empty.hidden = this.entries.length > 0;
  }

  private item(entry: Entry): HTMLElement {
    const button = (label: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wg-button";
      const name = document.createElement("span");
      name.className = "sr-only";
      name.textContent = ` «${entry.name}»`;
      b.append(label, name);
      b.addEventListener("click", run);
      return b;
    };
    const title = document.createElement("p");
    title.className = "wg-saves-name";
    title.textContent = entry.name;
    const details = document.createElement("p");
    details.className = "wg-saves-details";
    details.textContent = this.details(entry);
    const actions = document.createElement("div");
    actions.className = "wg-actions";
    actions.append(
      button("Laden", () => void this.load(entry.name)),
      button("Herunterladen", () => void this.downloadSaved(entry.name)),
      button("Löschen", () => void this.delete(entry.name)),
    );
    const li = document.createElement("li");
    li.className = "wg-saves-item";
    li.append(title, details, actions);
    return li;
  }

  private async saveAs() {
    const name = cleanName(this.name.value);
    if (!name) {
      this.name.setCustomValidity("Gib dem Wald einen Namen.");
      this.name.reportValidity();
      return;
    }
    await this.task("Der Wald liess sich nicht speichern.", async () => {
      if (
        this.entries.some((e) => e.name === name) &&
        !(await this.o.confirm({
          title: `«${name}» überschreiben?`,
          text: "Unter diesem Namen ist schon ein Wald gespeichert. Er wird durch den Wald ersetzt, in dem du jetzt bist.",
          yes: "Überschreiben",
        }))
      )
        return;
      await put(name, this.o.state);
      this.name.value = "";
      await this.refresh();
      this.say(`Gespeichert als «${name}».`);
    });
  }

  private async load(name: string) {
    await this.task(`«${name}» liess sich nicht laden.`, async () => {
      const yes = await this.o.confirm({
        title: `«${name}» laden?`,
        text: replaceText,
        yes: "Laden",
      });
      if (!yes) return;
      let next: Saved;
      try {
        next = await get(name, this.o.gameIds);
      } catch {
        this.say(`«${name}» ist beschädigt und lässt sich nicht laden.`);
        return;
      }
      this.say(`«${name}» wird geladen.`);
      await this.o.replace(next);
    });
  }

  private async downloadSaved(name: string) {
    await this.task(`«${name}» liess sich nicht herunterladen.`, async () => {
      download(name, await get(name, this.o.gameIds));
      this.say(`«${name}» wird heruntergeladen.`);
    });
  }

  private async delete(name: string) {
    await this.task(`«${name}» liess sich nicht löschen.`, async () => {
      const yes = await this.o.confirm({
        title: `«${name}» löschen?`,
        text: "Der gespeicherte Wald geht verloren. Der Wald, in dem du jetzt bist, bleibt.",
        yes: "Löschen",
      });
      if (!yes) return;
      await remove(name);
      await this.refresh();
      this.say(`«${name}» gelöscht.`);
    });
  }

  /**
   * Adds the forest from a file to the list, under its name, and offers to
   * load it.
   */
  private async fromFile(file: File) {
    await this.task("Der Wald liess sich nicht speichern.", async () => {
      let read: { name: string; state: Saved };
      try {
        read = await upload(file, this.o.gameIds);
      } catch {
        this.say("Diese Datei ist kein Wald der Waldstatt.");
        return;
      }
      const { state } = read;
      let name = read.name;
      // Keep a forest saved under the same name: number the new one.
      const taken = new Set(this.entries.map((e) => e.name));
      for (let i = 2; taken.has(name); i++)
        name = `${read.name.slice(0, 54)} (${i})`;
      await put(name, state);
      await this.refresh();
      this.say(`«${name}» ist jetzt unter den Wäldern.`);
      const yes = await this.o.confirm({
        title: `«${name}» jetzt laden?`,
        text: replaceText,
        yes: "Laden",
      });
      if (!yes) return;
      this.say(`«${name}» wird geladen.`);
      await this.o.replace(state);
    });
  }
}
