/**
 * The finders (ui.ts): «/» over the start and the texts found, the `goto`
 * commands, and «:» over every command (commands.ts), matched fuzzily by its
 * id and the words of its German description, each with the key bound to it;
 * what is typed runs as it is when it reads as a command or a chain, and
 * `up 15` reads as `up(15)`. A command that needs values it was not given
 * is put into the field, as `notify:info(`, to be completed. Arrows or Tab
 * move, Enter runs, Escape closes. Nodes are created with the DOM API.
 */
import type { Commands } from "./commands";
import { shortcut } from "./commandText";
import { el, fuzzy, need, plain } from "./dom";
import { keyLabel, keysFor } from "./keymap";
import type { Building } from "./state";

/** An entry of the finder: what it shows, a hint, and what it does. */
interface FinderItem {
  label: string;
  hint?: string;
  /** Why it cannot run now; it shows greyed. */
  why?: string;
  /** Chosen, it is put into the field to be completed instead of run. */
  fill?: string;
  run(): void;
}

/** What the finder needs from the interface. */
export interface FinderHost {
  commands: Commands;
  announce(text: string): void;
  focusMap(): void;
}

export class Finder {
  private element: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private prefix: HTMLElement;
  private mode: "/" | ":" = ":";
  private shown: FinderItem[] = [];
  private selected = 0;
  /** The building chosen when the finder opened, for its commands. */
  chosen: Building | undefined;

  constructor(
    root: HTMLElement,
    private host: FinderHost,
  ) {
    this.element = need(root, "[data-finder]");
    this.input = need<HTMLInputElement>(root, "[data-finder-input]");
    this.list = need(root, "[data-finder-list]");
    this.prefix = need(root, "[data-finder-prefix]");
    this.attach();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  private attach() {
    const f = this;
    f.input.addEventListener("input", () => this.filter());
    f.input.addEventListener("keydown", (event) => {
      const move = (by: number) => {
        event.preventDefault();
        if (!f.shown.length) return;
        f.selected = (f.selected + by + f.shown.length) % f.shown.length;
        this.mark();
      };
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey))
        move(1);
      else if (
        event.key === "ArrowUp" ||
        (event.key === "Tab" && event.shiftKey)
      )
        move(-1);
      else if (event.key === "Enter") {
        event.preventDefault();
        this.run(f.shown[f.selected]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      } else if (event.key === "Backspace" && !f.input.value) {
        // Like a command line: deleting the prefix leaves it.
        event.preventDefault();
        this.close(true);
      }
    });
    f.input.addEventListener("blur", () => {
      // Clicking an item happens before the blur closes the finder.
      window.setTimeout(() => {
        if (!f.element.contains(document.activeElement)) this.close();
      }, 150);
    });
  }

  /** Opens it, with the building chosen for the commands that act on one. */
  open(mode: "/" | ":", chosen: Building | undefined) {
    this.chosen = chosen;
    const f = this;
    f.mode = mode;
    f.prefix.textContent = mode;
    f.input.value = "";
    f.input.setAttribute(
      "aria-label",
      mode === "/" ? "Schrift suchen" : "Befehl suchen",
    );
    f.element.hidden = false;
    this.filter();
    f.input.focus();
  }

  close(focusMap = false) {
    const f = this;
    if (f.element.hidden) return;
    f.element.hidden = true;
    this.chosen = undefined;
    if (focusMap) this.host.focusMap();
  }

  /**
   * What the finder lists for what is typed. «/»: the start and the texts
   * found (the `goto` commands). «:»: every command, matched fuzzily by its
   * id and its German description; what is typed runs as it is if it reads
   * as a command or a chain, such as `up(20)` or `build:hütte;enter;right(3)`,
   * and «rep 30» reads as `repair:under(30)`.
   */
  private items(query: string): FinderItem[] {
    const c = this.host.commands;
    const keys = (text: string) => {
      const k = keysFor(text)[0];
      return k ? ` · ${keyLabel(k)}` : "";
    };
    const item = (
      text: string,
      description: string,
      why?: string,
      signature?: string,
    ): FinderItem => ({
      label: signature && signature !== text ? signature : text,
      hint: `${description}${keys(text)}`,
      why,
      // Values it needs and was not given are typed in the field.
      fill: signature && "error" in c.parse(text) ? `${text}(` : undefined,
      run: () => {
        if (!c.runText(text) && why) this.host.announce(why);
      },
    });
    const all = c.entries();
    if (this.mode === "/") {
      return all
        .filter((e) => e.text === "goto:start" || e.text.startsWith("goto:"))
        .map((e) => ({
          ...item(e.text, e.description, e.why),
          label: e.text.replace(/^goto:/, ""),
        }))
        .map((i) => ({ i, score: query.trim() ? fuzzy(query, i.label) : 0 }))
        .filter((m) => m.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((m) => m.i);
    }
    const typed: FinderItem[] = [];
    const q = query.trim();
    if (q) {
      // As typed, or with a space before its values, such as «up 15».
      for (const text of [q, ...shortcut(q)]) {
        const parsed = c.parse(text);
        if ("steps" in parsed) {
          const written = parsed.steps.map((s) => s.text).join(";");
          typed.push({
            label: written,
            hint: c.describe(parsed.steps),
            why:
              parsed.steps.length === 1
                ? parsed.steps[0].spec.unavailable?.(parsed.steps[0].args)
                : undefined,
            run: () => c.run(parsed.steps),
          });
          break;
        }
      }
      // Written as a command with values, or a script's: say what is wrong
      // rather than run something that only looks like it.
      if (!typed.length && !q.includes(";") && /\(|:\d/.test(q)) {
        const parsed = c.parse(q);
        if ("error" in parsed)
          typed.push({
            label: q,
            hint: "So geht es nicht",
            why: parsed.error,
            run: () => this.host.announce(parsed.error),
          });
      }
      if (!typed.length && q.includes(";")) {
        const parsed = c.parse(q);
        if ("error" in parsed)
          typed.push({
            label: q,
            hint: `Schritt ${parsed.step}`,
            why: parsed.error,
            run: () =>
              this.host.announce(`Schritt ${parsed.step}: ${parsed.error}`),
          });
      }
      const number = /^(\S+?)[\s:(-]+(\d{1,4})\)?$/.exec(q);
      if (!typed.length && number) {
        // A number after a partial id: the first command that takes one.
        const base = (text: string) => text.replace(/\(.*\)$/, "");
        const hit = all.find(
          (e) =>
            fuzzy(number[1], e.text) >= 0 &&
            "steps" in c.parse(`${base(e.text)}(${number[2]})`),
        );
        if (hit) {
          const text = `${base(hit.text)}(${number[2]})`;
          const parsed = c.parse(text);
          if ("steps" in parsed)
            typed.push({
              label: text,
              hint: c.describe(parsed.steps),
              run: () => c.run(parsed.steps),
            });
        }
      }
    }
    const listed = all
      .filter((e) => !e.text.startsWith("goto:") || e.text === "goto:start")
      .map((e) => item(e.text, e.description, e.why, e.signature))
      .map((i) => {
        // The id fuzzily; the German description by its words, costs and
        // keys left out, so «holz» finds Holzhacken, not every cost in wood.
        const words = plain((i.hint ?? "").split(" · ")[0]);
        const said = q && words.includes(plain(q)) ? 1 : -1;
        return { i, score: q ? Math.max(fuzzy(q, i.label), said) : 0 };
      })
      .filter((m) => m.score >= 0 && !typed.some((t) => t.label === m.i.label))
      .sort(
        (a, b) => b.score - a.score || Number(!!a.i.why) - Number(!!b.i.why),
      )
      .map((m) => m.i);
    return [...typed, ...listed];
  }

  /** Keeps the items that match what is typed, best first. */
  private filter() {
    const f = this;
    const query = f.input.value;
    f.shown = this.items(query).slice(0, 200);
    f.selected = 0;
    f.list.replaceChildren(
      ...(f.shown.length
        ? f.shown.map((item, i) => {
            const option = el(
              "li",
              { id: `wg-finder-${i}`, className: "wg-finder-item" },
              el("span", {}, item.label),
              el(
                "span",
                { className: "wg-finder-hint" },
                item.why
                  ? `${item.hint ?? ""} – ${item.why}`
                  : (item.hint ?? ""),
              ),
            );
            if (item.why) option.classList.add("wg-finder-unavailable");
            option.setAttribute("role", "option");
            option.addEventListener("pointerdown", (event) => {
              event.preventDefault();
              this.run(item);
            });
            return option;
          })
        : [
            el(
              "li",
              { className: "wg-finder-empty" },
              f.mode === ":" || query
                ? "Nichts passt."
                : "Noch nichts gefunden.",
            ),
          ]),
    );
    this.mark();
  }

  private mark() {
    const f = this;
    f.list.querySelectorAll<HTMLElement>("[role=option]").forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === f.selected));
      if (i === f.selected) o.scrollIntoView({ block: "nearest" });
    });
    if (f.shown.length)
      f.input.setAttribute("aria-activedescendant", `wg-finder-${f.selected}`);
    else f.input.removeAttribute("aria-activedescendant");
  }

  private run(item: FinderItem | undefined) {
    if (!item) return;
    if (item.fill !== undefined && this.input.value.trim() !== item.fill) {
      this.input.value = item.fill;
      this.filter();
      return;
    }
    // The building chosen when it opened stays chosen for the command.
    const chosen = this.chosen;
    this.close(true);
    this.chosen = chosen;
    try {
      item.run();
    } finally {
      this.chosen = undefined;
    }
  }
}
