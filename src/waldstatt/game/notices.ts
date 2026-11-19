/**
 * Notices over the map (ADR 0008): what `notify:info`, `notify:alert` and a
 * script's `say` show, and a script that stops with an error. An info fades
 * after a few seconds; an alert stays until it is closed. A few show at once,
 * the newest first; the same text again merges into one with a count. Each
 * is also read out through the live region. A notice from a script names it
 * and offers «Skript öffnen». They take no focus from the map; their buttons
 * are reached with Tab. Texts are shown as text, never as HTML.
 */
import { el } from "./dom";

export interface Notice {
  text: string;
  kind: "info" | "alert";
  /** The script it comes from, if any. */
  script?: string;
}

interface Shown {
  notice: Notice;
  element: HTMLElement;
  count: number;
  timer: number;
}

const limits = { shown: 4, infoSeconds: 6, text: 500 };

export class Notices {
  private shown: Shown[] = [];

  constructor(
    private host: HTMLElement,
    private o: {
      announce(text: string): void;
      /** Opens a script in the editor. */
      openScript(name: string): void;
    },
  ) {}

  show(notice: Notice) {
    const text = notice.text.slice(0, limits.text);
    const n = { ...notice, text };
    const same = this.shown.find(
      (s) =>
        s.notice.text === text &&
        s.notice.kind === n.kind &&
        s.notice.script === n.script,
    );
    this.o.announce(n.script ? `${n.script}: ${text}` : text);
    if (same) {
      same.count++;
      this.render(same);
      this.host.prepend(same.element);
      this.shown = [same, ...this.shown.filter((s) => s !== same)];
      this.arm(same);
      return;
    }
    const s: Shown = {
      notice: n,
      element: el("div", { className: `wg-notice wg-notice-${n.kind}` }),
      count: 1,
      timer: 0,
    };
    this.render(s);
    this.host.prepend(s.element);
    this.shown.unshift(s);
    this.arm(s);
    // The oldest go, an info before an alert.
    while (this.shown.length > limits.shown) {
      const old =
        [...this.shown].reverse().find((x) => x.notice.kind === "info") ??
        this.shown[this.shown.length - 1];
      this.remove(old);
    }
  }

  private arm(s: Shown) {
    window.clearTimeout(s.timer);
    if (s.notice.kind === "info")
      s.timer = window.setTimeout(
        () => this.remove(s),
        limits.infoSeconds * 1000,
      );
  }

  private remove(s: Shown) {
    window.clearTimeout(s.timer);
    s.element.remove();
    this.shown = this.shown.filter((x) => x !== s);
  }

  private render(s: Shown) {
    const { notice } = s;
    const parts: (HTMLElement | string)[] = [];
    if (notice.script)
      parts.push(el("span", { className: "wg-notice-from" }, notice.script));
    parts.push(
      el(
        "span",
        { className: "wg-notice-text" },
        notice.text,
        s.count > 1 ? ` (×${s.count})` : "",
      ),
    );
    const actions: HTMLElement[] = [];
    if (notice.script) {
      const open = el(
        "button",
        { type: "button", className: "wg-notice-button" },
        "Skript öffnen",
      );
      const name = notice.script;
      open.addEventListener("click", () => {
        this.remove(s);
        this.o.openScript(name);
      });
      actions.push(open);
    }
    if (notice.kind === "alert") {
      const close = el(
        "button",
        { type: "button", className: "wg-notice-close" },
        "×",
      );
      close.setAttribute("aria-label", "Meldung schliessen");
      close.addEventListener("click", () => this.remove(s));
      actions.push(close);
    }
    s.element.replaceChildren(
      el("p", {}, ...parts),
      ...(actions.length
        ? [el("div", { className: "wg-notice-actions" }, ...actions)]
        : []),
    );
  }
}
