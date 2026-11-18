/**
 * The dialog «Tasten» from the menu and the «:» finder (ADR 0005): lists each
 * action with its keys, removes a key with its ×, and adds one with «+ Taste»
 * and the next key pressed. A key that another action has, or one that
 * cannot be bound, is refused with the reason, and the dialog waits for
 * another; Escape stops waiting, Tab moves on. «Standard» brings the default
 * keys back after asking. Every change is kept at once (keys.ts). Nodes are
 * created with the DOM API.
 */
import {
  bind,
  groups,
  isModifier,
  keyLabel,
  keysOf,
  keySpoken,
  normal,
  onChange,
  reset,
  scopeOf,
  unbind,
  type Action,
} from "./keys";

export interface KeysOptions {
  root: HTMLElement;
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

export class KeysDialog {
  private dialog: HTMLDialogElement;
  private list: HTMLElement;
  private status: HTMLElement;
  /** The action waiting for its new key, and its «+ Taste» button. */
  private waiting: { action: Action; name: string } | null = null;
  /** A key taken while waiting: its release must not press a button. */
  private taken: string | null = null;

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
    this.dialog.addEventListener("close", () => this.stopWaiting());
    onChange(() => {
      if (this.dialog.open) this.render();
    });
  }

  open() {
    this.say("");
    this.render();
    if (this.dialog.open) return;
    this.dialog.showModal();
    // Not onto a ×, where a stray Enter would remove a key.
    this.list.querySelector<HTMLElement>("[data-keys-add]")?.focus();
  }

  /** Says what happened, in the dialog and to screen readers. */
  private say(text: string) {
    this.status.textContent = text;
    if (text) this.o.announce(text);
  }

  private render() {
    const focused = (document.activeElement as HTMLElement | null)?.dataset
      .keysAdd;
    this.list.replaceChildren(
      ...groups.map((group) => {
        const heading = document.createElement("h3");
        heading.textContent = group.name;
        const rows = document.createElement("ul");
        rows.className = "wg-keymap-list";
        rows.append(...group.actions.map(([a, name]) => this.row(a, name)));
        const section = document.createElement("section");
        section.append(heading, rows);
        return section;
      }),
    );
    if (focused)
      this.list
        .querySelector<HTMLElement>(`[data-keys-add="${focused}"]`)
        ?.focus();
  }

  private row(action: Action, name: string): HTMLElement {
    const label = document.createElement("span");
    label.className = "wg-keymap-name";
    label.textContent = name;
    const keys = document.createElement("span");
    keys.className = "wg-keymap-keys";
    for (const key of keysOf(action)) {
      const kbd = document.createElement("kbd");
      kbd.textContent = keyLabel(key);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "wg-keymap-remove";
      remove.textContent = "×";
      remove.setAttribute(
        "aria-label",
        `«${keySpoken(key)}» bei «${name}» entfernen`,
      );
      remove.addEventListener("click", () => {
        unbind(action, key);
        this.say(`«${keyLabel(key)}» bei «${name}» entfernt.`);
        this.focusAdd(action);
      });
      const chip = document.createElement("span");
      chip.className = "wg-keymap-key";
      chip.append(kbd, remove);
      keys.append(chip);
    }
    if (!keysOf(action).length) {
      const none = document.createElement("span");
      none.className = "wg-keymap-none";
      none.textContent = "keine Taste";
      keys.append(none);
    }
    const waiting = this.waiting?.action === action;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "wg-button wg-keymap-add";
    add.dataset.keysAdd = action;
    add.textContent = waiting ? "Taste drücken …" : "+ Taste";
    add.setAttribute("aria-pressed", String(waiting));
    add.setAttribute("aria-label", `Taste für «${name}» hinzufügen`);
    add.addEventListener("click", () => {
      if (this.waiting?.action === action) return this.stopWaiting(true);
      this.waiting = { action, name };
      this.render();
      this.focusAdd(action);
      this.say(`Drücke die neue Taste für «${name}». Escape bricht ab.`);
    });
    const li = document.createElement("li");
    li.className = "wg-keymap-row";
    li.append(label, keys, add);
    return li;
  }

  private focusAdd(action: Action) {
    this.list
      .querySelector<HTMLElement>(`[data-keys-add="${action}"]`)
      ?.focus();
  }

  private stopWaiting(say = false) {
    if (!this.waiting) return;
    const { action } = this.waiting;
    this.waiting = null;
    if (!this.dialog.open) return;
    this.render();
    this.focusAdd(action);
    if (say) this.say("Keine Taste hinzugefügt.");
  }

  /** The next key pressed while an action waits for one. */
  private key(event: KeyboardEvent) {
    const w = this.waiting;
    if (!w || isModifier(event.key)) return;
    // Tab moves on as always.
    if (event.key === "Tab") return this.stopWaiting();
    event.preventDefault();
    event.stopPropagation();
    this.taken = event.key;
    if (event.key === "Escape") return this.stopWaiting(true);
    if (event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey)
      return this.say("Nur Tasten ohne Strg, Alt oder Cmd.");
    const refused = bind(w.action, event.key);
    if (refused) return this.say(refused);
    this.waiting = null;
    this.render();
    this.focusAdd(w.action);
    this.say(
      `«${keyLabel(normal(event.key, scopeOf(w.action)))}» bei «${w.name}» hinzugefügt.`,
    );
  }

  private async restore() {
    this.stopWaiting();
    const yes = await this.o.confirm({
      title: "Standardtasten?",
      text: "Alle Tasten werden wieder wie am Anfang: Pfeile, h j k l und s e i u bewegen, a wählt Holzhacken, r Reparieren. Deine Änderungen gehen verloren.",
      yes: "Standard",
    });
    if (!yes) return;
    reset();
    this.say("Die Standardtasten gelten wieder.");
  }
}
