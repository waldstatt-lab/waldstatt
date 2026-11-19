/**
 * The key dispatcher (ADR 0006): every key pressed on the map, on a
 * building's card or anywhere on the page goes through it. Digits typed
 * first make a count; keys that begin a longer bound sequence wait for the
 * next one, up to a second, and a badge shows the keys so far. The sequence
 * is looked up in the keymap (keymap.ts) for the active contexts, and its
 * command or chain runs (commands.ts) with the count. A letter typed with
 * Shift that is not bound as such counts as the letter, and a movement with
 * Shift pans the view instead. Movements held down step at the map's own
 * pace; the text cursor follows the keyboard's repeat; everything else runs
 * once per press. On the page outside the map, only commands that work
 * anywhere run (tools, menus, finders). Escape drops a count or a sequence
 * begun; otherwise it is the caller's to handle.
 */
import type { Commands, Context, Step } from "./commands";
import { keyName, resolve, unshifted } from "./keymap";

export interface DispatchHooks {
  contexts(): Set<Context>;
  /** Shows the count typed and the keys of a sequence begun. */
  status(count: number, keys: string[]): void;
  /** Pans the view by directions held, smoothly. */
  pan(dx: number, dy: number, dt: number): void;
  announce(text: string): void;
}

/** Where the key was pressed: on the map, on a card, or elsewhere on the page. */
export type Origin = "map" | "card" | "page";

/** Milliseconds a sequence begun waits for its next key. */
const wait = 1000;
const maxCount = 9999;

interface Held {
  /** Runs one more step; or pans this way. */
  step?: () => void;
  pan?: [number, number];
  since: number;
  next: number;
}

export class Dispatcher {
  private count = 0;
  private pending: string[] = [];
  private timer = 0;
  private held = new Map<string, Held>();
  private loop = 0;
  private last = 0;
  private parsed = new Map<string, Step[] | string>();

  constructor(
    private commands: Commands,
    private hooks: DispatchHooks,
  ) {}

  /** A key went down; returns whether it was taken. */
  keydown(event: KeyboardEvent, origin: Origin): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const name = keyName(event);
    if (!name) return false;
    if (name === "escape") {
      if (!this.count && !this.pending.length) return false;
      this.clear();
      return true;
    }
    if (name === "tab") return false;
    // Digits make a count, a lone 0 nothing (Shift allowed: AZERTY needs it).
    if (
      origin !== "page" &&
      /^[0-9]$/.test(event.key) &&
      !this.pending.length
    ) {
      if (event.key !== "0" || this.count)
        this.count = Math.min(maxCount, this.count * 10 + Number(event.key));
      this.show();
      return true;
    }
    return this.press(name, event, origin);
  }

  keyup(event: KeyboardEvent) {
    const name = keyName(event);
    if (name) {
      this.held.delete(name);
      const base = unshifted(name);
      if (base) this.held.delete(base);
    }
    if (event.key === "Shift")
      for (const [key, h] of this.held) if (h.pan) this.held.delete(key);
  }

  /** Focus left: nothing stays held, counted or begun. */
  blur() {
    this.held.clear();
    this.clear();
  }

  /** Drops the count and a sequence begun. */
  clear() {
    window.clearTimeout(this.timer);
    this.count = 0;
    this.pending = [];
    this.show();
  }

  private show() {
    this.hooks.status(this.count, this.pending);
  }

  private press(name: string, event: KeyboardEvent, origin: Origin): boolean {
    const active = this.hooks.contexts();
    let keys = [...this.pending, name];
    let found = resolve(keys, active);
    let shift = false;
    if (found.command === undefined && !found.longer) {
      // Shift with a key not bound as such: the key itself, held with Shift.
      const base = unshifted(name);
      if (base) {
        const other = resolve([...this.pending, base], active);
        if (other.command !== undefined || other.longer) {
          keys = [...this.pending, base];
          found = other;
          shift = true;
        }
      }
    }
    window.clearTimeout(this.timer);
    if (found.longer) {
      this.pending = keys;
      this.show();
      const exact = found.command;
      this.timer = window.setTimeout(() => {
        this.pending = [];
        if (exact) this.execute(exact, keys, false, origin, shift, name);
        this.show();
      }, wait);
      return true;
    }
    if (found.command === undefined) {
      if (this.pending.length) {
        // The sequence went nowhere: the key starts afresh.
        this.pending = [];
        return this.press(name, event, origin);
      }
      this.count = 0;
      this.show();
      return false;
    }
    this.pending = [];
    if (found.command === null) {
      this.count = 0;
      this.show();
      return true;
    }
    return this.execute(found.command, keys, event.repeat, origin, shift, name);
  }

  private steps(command: string): Step[] | string {
    let steps = this.parsed.get(command);
    if (!steps) {
      const parsed = this.commands.parse(command);
      steps = "error" in parsed ? parsed.error : parsed.steps;
      // Kept only when it reads, and not for scripts' commands, which come
      // and go as scripts are switched on and edited (ADR 0008).
      if (typeof steps !== "string" && !command.includes("$")) {
        if (this.parsed.size > 500) this.parsed.clear();
        this.parsed.set(command, steps);
      }
    }
    return steps;
  }

  private execute(
    command: string,
    keys: string[],
    repeat: boolean,
    origin: Origin,
    shift: boolean,
    pressed: string,
  ): boolean {
    const steps = this.steps(command);
    if (typeof steps === "string") {
      this.count = 0;
      this.show();
      this.hooks.announce(`«${keys.join(" ")}»: ${steps}`);
      return true;
    }
    if (origin === "page" && !steps.every((s) => s.spec.global)) {
      this.count = 0;
      this.show();
      return false;
    }
    const count = this.count;
    this.count = 0;
    this.show();
    const one = steps.length === 1 ? steps[0].spec : undefined;
    if (one?.hold) {
      // The keyboard's own repeat is ignored: the loop sets the pace.
      if (repeat || this.held.has(pressed)) return true;
      const now = performance.now();
      if (shift && one.pan) {
        this.held.set(pressed, { pan: one.pan, since: now, next: now });
      } else {
        this.commands.run(steps, count);
        this.held.set(pressed, {
          step: () => this.commands.run(steps),
          since: now,
          next: now + 220,
        });
      }
      if (!this.loop) {
        this.last = now;
        this.loop = requestAnimationFrame(this.tick);
      }
      return true;
    }
    if (repeat && !one?.repeats) return true;
    this.commands.run(steps, count);
    return true;
  }

  /** Steps held movements at an even pace, and pans smoothly. */
  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let x = 0;
    let y = 0;
    for (const h of this.held.values()) {
      if (h.pan) {
        x += h.pan[0];
        y += h.pan[1];
      } else if (h.step && now >= h.next) {
        h.step();
        // A pause after the first step, then steady steps.
        h.next = now + (now - h.since < 100 ? 220 : 85);
      }
    }
    if (x || y) this.hooks.pan(x, y, dt);
    this.loop = this.held.size ? requestAnimationFrame(this.tick) : 0;
  };
}
