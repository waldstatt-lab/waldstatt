/**
 * The theatre's stage, painted into one canvas that lies on the amphitheatre's
 * floor (render.ts): the preview of a game, a status line, and wooden signs
 * for the programme, for each key of the game's controls and for the real
 * game. Signs are pressed by tapping them on the map; while the view is
 * turned onto the stage, the keyboard plays too. A demonstration plays until
 * somebody takes over, and again after eight idle seconds; with reduced
 * motion there is none.
 */
import type { Game, Input, Report } from "./preview";
import { carGame } from "./previewCar";
import { motoGame } from "./previewMoto";
import type { GameInfo } from "./texts";

/** Canvas pixels per tile. */
export const STAGE_RES = 96;

interface KeySign {
  action: string;
  label: string;
  text: string;
}

/** The previews, with the wooden signs for the keys of each game's controls. */
const shows: Record<
  string,
  { make: (report: Report) => Game; keys: KeySign[] }
> = {
  "moto-devil": {
    make: motoGame,
    keys: [
      { action: "gas", label: "W / ↑", text: "Gas" },
      { action: "brake", label: "S / ↓", text: "Bremsen" },
      { action: "back", label: "A / ←", text: "Kippen" },
      { action: "forward", label: "D / →", text: "Kippen" },
      { action: "jump", label: "Leertaste", text: "Springen" },
      { action: "turn", label: "E", text: "Umdrehen" },
      { action: "restart", label: "R", text: "Neu" },
    ],
  },
  "car-drive": {
    make: carGame,
    keys: [
      { action: "left", label: "A / ←", text: "Links" },
      { action: "right", label: "D / →", text: "Rechts" },
      { action: "boost", label: "Leertaste", text: "Boost" },
      { action: "restart", label: "R", text: "Neustart" },
    ],
  },
};

/** Whether a game has a preview for the stage. */
export const hasShow = (id: string) => id in shows;

type Hit =
  | { type: "programme"; id: string }
  | { type: "key"; action: string }
  | { type: "play" };

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  hit: Hit;
}

const idleMs = 8000;
const statNames: Record<string, string> = {
  saltos: "Saltos",
  metres: "Strecke",
  level: "Level",
  coins: "Münzen",
};
const serif = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const sans = 'system-ui, "Segoe UI", Roboto, sans-serif';

export class Stage {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private games = new Map<string, Game>();
  private current = "";
  private input: Input = { held: new Set(), pressed: new Set() };
  private demo = true;
  private lastInput = -Infinity;
  private status = "";
  private stats = new Map<string, string>();
  private regions: Region[] = [];
  private clock = 0;
  /** Set when the picture changed and the texture needs an update. */
  dirty = true;

  constructor(
    /** The stage's size in tiles. */
    readonly w: number,
    readonly h: number,
    private programme: () => GameInfo[],
    private still: () => boolean,
    private announce: (text: string) => void,
  ) {
    this.canvas.width = Math.round(w * STAGE_RES);
    this.canvas.height = Math.round(h * STAGE_RES);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context");
    this.ctx = ctx;
    this.choose(this.programme()[0]?.id ?? "");
  }

  /** The games whose Spielhaus stands and that have a preview. */
  private list(): GameInfo[] {
    return this.programme().filter((g) => hasShow(g.id));
  }

  /** Called when the programme may have changed. */
  refresh() {
    const list = this.list();
    if (!list.some((g) => g.id === this.current))
      this.choose(list[0]?.id ?? "");
    this.dirty = true;
  }

  private game(): Game | undefined {
    if (!this.current) return undefined;
    let game = this.games.get(this.current);
    if (!game) {
      const report: Report = {
        say: (text) => {
          this.status = text;
          if (!this.demo) this.announce(text);
        },
        stat: (name, value) => this.stats.set(name, String(value)),
      };
      game = shows[this.current].make(report);
      this.games.set(this.current, game);
      game.step(0, this.input, false);
    }
    return game;
  }

  private choose(id: string) {
    if (!hasShow(id)) {
      this.current = "";
      return;
    }
    this.release();
    this.current = id;
    this.status = "";
    this.stats.clear();
    this.demo = !this.still();
    this.dirty = true;
  }

  /** The game a tap at stage pixels (x, y) would affect, if any. */
  hitAt(x: number, y: number): Hit | null {
    for (const r of this.regions)
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
        return r.hit;
    return null;
  }

  /** A tap or press at stage pixels: returns the URL to open for «spielen». */
  pressAt(x: number, y: number): { handled: boolean; open?: string } {
    const hit = this.hitAt(x, y);
    if (!hit) return { handled: false };
    if (hit.type === "programme") {
      this.choose(hit.id);
      return { handled: true };
    }
    if (hit.type === "play") {
      const game = this.list().find((g) => g.id === this.current);
      return { handled: true, open: game?.playUrl };
    }
    this.press(hit.action);
    return { handled: true };
  }

  /** A key from the game's controls table; returns whether it belongs to the game. */
  key(event: KeyboardEvent, down: boolean): boolean {
    const action = this.game()?.keys[event.key.toLowerCase()];
    if (!action) return false;
    if (down && !event.repeat) this.press(action);
    if (!down) this.release(action);
    return true;
  }

  press(action: string) {
    if (!this.input.held.has(action)) this.input.pressed.add(action);
    this.input.held.add(action);
    this.lastInput = performance.now();
    this.demo = false;
    this.dirty = true;
  }

  /** Lets go of one action, or of all. */
  release(action?: string) {
    if (action) this.input.held.delete(action);
    else this.input.held.clear();
    this.dirty = true;
  }

  /** Runs and paints the stage; call while it is on screen. */
  frame(dt: number) {
    const game = this.game();
    this.clock += dt;
    // About 30 pictures a second are plenty.
    if (this.clock < 1 / 32 && !this.dirty) return;
    const step = Math.min(0.05, this.clock);
    this.clock = 0;
    const now = performance.now();
    if (
      !this.demo &&
      now - this.lastInput > idleMs &&
      this.input.held.size === 0 &&
      !this.still()
    )
      this.demo = true;
    const playing =
      this.demo || now - this.lastInput < idleMs || this.input.held.size > 0;
    if (game && playing) {
      game.step(step, this.input, this.demo);
      this.input.pressed.clear();
    }
    this.paint(game);
    this.dirty = true;
  }

  // --- Painting -----------------------------------------------------------

  private board(x: number, y: number, w: number, h: number, lit: boolean) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(20, 12, 4, 0.45)";
    ctx.fillRect(x + 4, y + 5, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, lit ? "#f0c35a" : "#a8743f");
    g.addColorStop(1, lit ? "#c9932e" : "#7a5230");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.strokeStyle = "rgba(58, 38, 20, 0.35)";
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(x + 4, y + (h * k) / 3);
      ctx.lineTo(x + w - 4, y + (h * k) / 3);
      ctx.stroke();
    }
    ctx.fillStyle = "#3a2614";
    for (const nx of [x + 8, x + w - 8]) {
      ctx.beginPath();
      ctx.arc(nx, y + 8, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private sign(
    x: number,
    y: number,
    w: number,
    h: number,
    top: string,
    bottom: string,
    lit: boolean,
    hit: Hit,
  ) {
    const ctx = this.ctx;
    this.board(x, y, w, h, lit);
    ctx.fillStyle = lit ? "#2a1d12" : "#f6ead0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (bottom) {
      ctx.font = `700 22px ${sans}`;
      ctx.fillText(top, x + w / 2, y + h * 0.36, w - 12);
      ctx.font = `500 18px ${sans}`;
      ctx.fillText(bottom, x + w / 2, y + h * 0.72, w - 12);
    } else {
      ctx.font = `700 22px ${sans}`;
      ctx.fillText(top, x + w / 2, y + h / 2, w - 12);
    }
    this.regions.push({ x, y, w, h, hit });
  }

  private paint(game: Game | undefined) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.regions = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The stage's floorboards.
    ctx.fillStyle = "#a8743f";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 32) {
      ctx.fillStyle = (y / 32) % 2 ? "#a06d3a" : "#b07a44";
      ctx.fillRect(0, y, W, 30);
      ctx.fillStyle = "#6b4423";
      ctx.fillRect(0, y + 30, W, 2);
    }
    ctx.strokeStyle = "#4a3320";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    const pad = 24;
    ctx.fillStyle = "#2a1d12";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 34px ${serif}`;
    ctx.fillText("Theater der Waldstatt", pad, 54);
    const list = this.list();
    let x = pad;
    for (const show of list) {
      const w = Math.min(200, 26 + show.title.length * 13);
      this.sign(x, 72, w, 48, show.title, "", show.id === this.current, {
        type: "programme",
        id: show.id,
      });
      x += w + 14;
    }
    if (!game) {
      ctx.fillStyle = "#2a1d12";
      ctx.font = `500 24px ${sans}`;
      ctx.fillText(
        "Das Programm ist leer: Bau zuerst ein Spielhaus.",
        pad,
        180,
      );
      return;
    }

    // The game, framed like a painted backdrop.
    const viewW = W - pad * 2;
    const scale = viewW / game.width;
    const viewH = game.height * scale;
    const top = 140;
    ctx.fillStyle = "#8c2b33";
    ctx.fillRect(pad - 8, top - 8, viewW + 16, viewH + 16);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, top, viewW, viewH);
    ctx.clip();
    ctx.setTransform(scale, 0, 0, scale, pad, top);
    game.draw(ctx, scale);
    ctx.restore();

    let y = top + viewH + 36;
    ctx.fillStyle = "#2a1d12";
    ctx.textAlign = "left";
    ctx.font = `600 22px ${sans}`;
    const mode = this.demo
      ? "Vorführung – tipp ein Schild oder drück eine Taste."
      : "Du spielst.";
    const stats = [...this.stats.values()].length
      ? `   ${[...this.stats.entries()].map(([k, v]) => `${statNames[k] ?? k}: ${v}`).join("  ")}`
      : "";
    ctx.fillText(`${mode} ${this.status}${stats}`.trim(), pad, y, W - pad * 2);
    y += 18;

    // The keys as wooden signs, four in a row.
    const keys = shows[this.current].keys;
    const perRow = 4;
    const gap = 12;
    const signW = (W - pad * 2 - gap * (perRow - 1)) / perRow;
    keys.forEach((key, i) => {
      const sx = pad + (i % perRow) * (signW + gap);
      const sy = y + Math.floor(i / perRow) * 76;
      this.sign(
        sx,
        sy,
        signW,
        64,
        key.label,
        key.text,
        this.input.held.has(key.action),
        {
          type: "key",
          action: key.action,
        },
      );
    });
    y += Math.ceil(keys.length / perRow) * 76 + 4;
    const title = list.find((g) => g.id === this.current)?.title ?? "";
    this.sign(pad, y, W - pad * 2, 52, `${title} richtig spielen`, "", true, {
      type: "play",
    });
  }
}
