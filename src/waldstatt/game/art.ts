/**
 * The game's art, painted for the Waldstatt on canvases at twice the world
 * resolution: shaded trees, Waldleute, buildings seen from the isometric
 * angle, and the ground textures. The light comes from the upper left. The
 * look borrows the genre's isometric view, not any game's pictures: nothing is
 * traced or copied.
 */
import { iseColours, STAGE, type Kind } from "./config";
import { TH, TW } from "./iso";
import { hash } from "./world";

/** Canvas pixels per world unit, so the art stays sharp when zoomed in. */
export const RES = 2;

type Ctx = CanvasRenderingContext2D;
type Point = [number, number, number];

export interface Picture {
  canvas: HTMLCanvasElement;
  /** Where the anchor (the footprint's centre on the ground) lies, in world units. */
  ax: number;
  ay: number;
}

function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = Math.ceil(w * RES);
  element.height = Math.ceil(h * RES);
  // A canvas on the CPU: some browsers, such as Zen on Linux, swap red and
  // blue when a canvas drawn on the GPU becomes a WebGL texture.
  const ctx = element.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context");
  ctx.scale(RES, RES);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { element, ctx };
}

/** A small deterministic random generator, so the art is the same every time. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lightens (f > 0) or darkens (f < 0) a "#rrggbb" colour. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) =>
    Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

// --- Trees ----------------------------------------------------------------

export const treeFrame = { w: 84, h: 128, ax: 42, ay: 116 };

const conifers = [
  { light: "#4d8a4a", dark: "#1f4a2a", deep: "#143520", height: 1 },
  { light: "#5a9550", dark: "#255432", deep: "#173c24", height: 0.9 },
  { light: "#447f55", dark: "#1c4434", deep: "#122f25", height: 1.08 },
  { light: "#558c44", dark: "#2b5129", deep: "#1b3a1c", height: 0.95 },
];
const broadleaves = [
  { light: "#8cbf5a", mid: "#5f9a3c", dark: "#3c6b27" },
  { light: "#a7c25a", mid: "#78a03e", dark: "#4f7426" },
];

function conifer(
  ctx: Ctx,
  ox: number,
  c: (typeof conifers)[number],
  seed: number,
) {
  const rnd = random(seed);
  const bx = ox + treeFrame.ax;
  const by = treeFrame.ay;
  ellipse(ctx, bx + 12, by - 1, 26, 9, "rgba(10, 25, 12, 0.32)");
  const trunk = ctx.createLinearGradient(bx - 4, 0, bx + 4, 0);
  trunk.addColorStop(0, "#7a5636");
  trunk.addColorStop(1, "#3e2817");
  ctx.fillStyle = trunk;
  ctx.fillRect(bx - 3.5, by - 20, 7, 20);
  const total = 98 * c.height;
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const top = by - 16 - total + i * (total / tiers) * 0.82;
    const height = (total / tiers) * 1.45;
    const hw = 8 + t * 21;
    const bottom = top + height;
    const gradient = ctx.createLinearGradient(bx - hw, top, bx + hw, bottom);
    gradient.addColorStop(0, c.light);
    gradient.addColorStop(0.55, c.dark);
    gradient.addColorStop(1, c.deep);
    ctx.beginPath();
    ctx.moveTo(bx, top);
    // Ragged edges and a drooping, toothed lower rim.
    const steps = 7;
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      ctx.lineTo(bx + hw * f + (rnd() - 0.5) * 2, top + height * f * 0.92);
    }
    const teeth = 9;
    for (let k = teeth; k >= 0; k--) {
      const x = bx - hw + (2 * hw * k) / teeth;
      ctx.lineTo(x, bottom - (k % 2 ? 5 + rnd() * 3 : 0));
    }
    for (let k = steps; k >= 1; k--) {
      const f = k / steps;
      ctx.lineTo(bx - hw * f + (rnd() - 0.5) * 2, top + height * f * 0.92);
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    // Needles: short strokes, lighter on the lit side.
    for (let k = 0; k < 40 + i * 12; k++) {
      const f = 0.25 + rnd() * 0.75;
      const x = bx + (rnd() * 2 - 1) * hw * f;
      const y = top + height * f * 0.9;
      const lit = x < bx - hw * 0.1;
      ctx.strokeStyle = lit
        ? `rgba(190, 230, 150, ${0.15 + rnd() * 0.2})`
        : `rgba(5, 25, 12, ${0.2 + rnd() * 0.25})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x < bx ? -2.5 : 2.5), y + 2.5);
      ctx.stroke();
    }
  }
}

function broadleaf(
  ctx: Ctx,
  ox: number,
  c: (typeof broadleaves)[number],
  seed: number,
) {
  const rnd = random(seed);
  const bx = ox + treeFrame.ax;
  const by = treeFrame.ay;
  ellipse(ctx, bx + 14, by - 1, 30, 10, "rgba(10, 25, 12, 0.3)");
  const trunk = ctx.createLinearGradient(bx - 5, 0, bx + 5, 0);
  trunk.addColorStop(0, "#8a6a48");
  trunk.addColorStop(1, "#4a3220");
  ctx.fillStyle = trunk;
  ctx.beginPath();
  ctx.moveTo(bx - 4, by);
  ctx.lineTo(bx - 2.5, by - 40);
  ctx.lineTo(bx + 2.5, by - 40);
  ctx.lineTo(bx + 4, by);
  ctx.fill();
  const cy = by - 66;
  const blobs: [number, number, number][] = [];
  for (let k = 0; k < 11; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 18;
    blobs.push([
      bx + Math.cos(a) * d * 1.1,
      cy + Math.sin(a) * d * 0.85,
      13 + rnd() * 7,
    ]);
  }
  // Back to front, so the lower blobs overlap.
  blobs.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(
      x - r * 0.4,
      y - r * 0.45,
      r * 0.15,
      x,
      y,
      r,
    );
    g.addColorStop(0, c.light);
    g.addColorStop(0.6, c.mid);
    g.addColorStop(1, c.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  for (let k = 0; k < 90; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 30;
    const x = bx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.8;
    ctx.fillStyle =
      x + y < bx + cy ? "rgba(230, 255, 180, 0.25)" : "rgba(20, 50, 10, 0.25)";
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Six trees side by side: four firs, two broadleaf trees. */
export function treeAtlas(): HTMLCanvasElement {
  const { element, ctx } = canvas(treeFrame.w * 6, treeFrame.h);
  conifers.forEach((c, i) => conifer(ctx, i * treeFrame.w, c, 11 + i));
  broadleaves.forEach((c, i) =>
    broadleaf(ctx, (4 + i) * treeFrame.w, c, 31 + i),
  );
  return element;
}

/** A red ribbon on a marked tree. */
export function ribbon(): Picture {
  const { element, ctx } = canvas(16, 12);
  ctx.fillStyle = "#c8341f";
  ctx.beginPath();
  ctx.ellipse(8, 5, 6, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e86a4c";
  ctx.fillRect(3, 3.5, 6, 1.2);
  ctx.fillStyle = "#c8341f";
  ctx.beginPath();
  ctx.moveTo(11, 6);
  ctx.lineTo(14, 11);
  ctx.lineTo(11.5, 10);
  ctx.lineTo(10, 11.5);
  ctx.fill();
  return { canvas: element, ax: 8, ay: 5 };
}

// --- Items on the ground and the ravens ----------------------------------------

/** A golden glint that draws the eye to something lying on the ground. */
function glint(ctx: Ctx, x: number, y: number, r: number) {
  ctx.fillStyle = "rgba(255, 244, 190, 0.95)";
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.22, y - r * 0.22);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.22, y + r * 0.22);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.22, y + r * 0.22);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.22, y - r * 0.22);
  ctx.fill();
}

/** The axe in a stump, or the saw on a log: tools waiting to be picked up. */
export function itemPicture(item: "axe" | "saw"): Picture {
  const { element, ctx } = canvas(48, 44);
  const ax = 24;
  const ay = 36;
  ellipse(ctx, ax + 3, ay + 1, 15, 5, "rgba(0, 0, 0, 0.3)");
  if (item === "axe") {
    // A stump with the axe struck into it.
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(ax - 10, ay - 12, 20, 12);
    ellipse(ctx, ax, ay, 10, 4, "#5a3a20");
    ellipse(ctx, ax, ay - 12, 10, 4, "#c9a46c");
    ctx.strokeStyle = "#8a6a42";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(ax, ay - 12, 5, 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#7a4e26";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(ax + 2, ay - 14);
    ctx.lineTo(ax + 15, ay - 33);
    ctx.stroke();
    ctx.fillStyle = "#9aa4ad";
    ctx.beginPath();
    ctx.moveTo(ax - 5, ay - 18);
    ctx.lineTo(ax + 4, ay - 16);
    ctx.lineTo(ax + 6, ay - 11);
    ctx.lineTo(ax - 4, ay - 11);
    ctx.fill();
    ctx.fillStyle = "#dfe6ec";
    ctx.fillRect(ax - 4, ay - 12.5, 9, 1.4);
    glint(ctx, ax + 15, ay - 33, 5);
  } else {
    // A log with a frame saw lying across it.
    ctx.fillStyle = "#7a4e26";
    ctx.fillRect(ax - 18, ay - 9, 30, 9);
    ellipse(ctx, ax + 12, ay - 4.5, 3.5, 4.5, "#c9a46c");
    ctx.fillStyle = "#c2cad1";
    ctx.beginPath();
    ctx.moveTo(ax - 20, ay - 12);
    ctx.lineTo(ax + 18, ay - 18);
    ctx.lineTo(ax + 18, ay - 15);
    ctx.lineTo(ax - 20, ay - 9);
    ctx.fill();
    ctx.fillStyle = "#6f7880";
    for (let k = 0; k < 12; k++) {
      const x = ax - 19 + k * 3.1;
      const y = ay - 9.4 - k * 0.49;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1.5, y + 2);
      ctx.lineTo(x + 3, y - 0.4);
      ctx.fill();
    }
    ctx.strokeStyle = "#8a5a32";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(ax - 18, ay - 11);
    ctx.lineTo(ax - 18, ay - 25);
    ctx.lineTo(ax + 16, ay - 31);
    ctx.lineTo(ax + 16, ay - 17);
    ctx.stroke();
    glint(ctx, ax + 16, ay - 31, 5);
  }
  return { canvas: element, ax, ay };
}

/**
 * A tile of the palisade along the national border: three sharpened logs
 * bound by a rail, anchored at the tile's centre.
 */
export function palisadePicture(): Picture {
  const { element, ctx } = canvas(44, 64);
  const ax = 22;
  const ay = 52;
  ellipse(ctx, ax + 4, ay + 1, 20, 7, "rgba(0, 0, 0, 0.28)");
  for (const [dx, dy, h] of [
    [-12, -6, 38],
    [-1, 0, 42],
    [10, 6, 37],
  ]) {
    const x = ax + dx;
    const y = ay + dy;
    const g = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
    g.addColorStop(0, "#a87a4c");
    g.addColorStop(0.6, "#7a5230");
    g.addColorStop(1, "#5a3a20");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x - 5, y - h);
    ctx.lineTo(x, y - h - 8);
    ctx.lineTo(x + 5, y - h);
    ctx.lineTo(x + 5, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ellipse(ctx, x, y, 5, 2, "#4a3320");
  }
  ctx.strokeStyle = "#4a3018";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(ax - 18, ay - 31);
  ctx.lineTo(ax + 16, ay - 14);
  ctx.stroke();
  return { canvas: element, ax, ay };
}

export const ravenFrame = { w: 40, h: 28, ax: 20, ay: 16 };

/** A raven facing right in three wing beats: up, level, down. */
export function ravenAtlas(): HTMLCanvasElement {
  const { element, ctx } = canvas(ravenFrame.w * 3, ravenFrame.h);
  const black = "#16141c";
  const sheen = "#3a3c58";
  for (let f = 0; f < 3; f++) {
    const x = f * ravenFrame.w + ravenFrame.ax;
    const y = ravenFrame.ay;
    const lift = [-11, -1, 8][f];
    // Far wing, body, tail, head and beak, near wing.
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 2);
    ctx.quadraticCurveTo(x - 4, y + lift - 4, x - 12, y + lift * 0.9 - 2);
    ctx.lineTo(x + 3, y);
    ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath();
    ctx.ellipse(x, y, 9, 3.6, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 1);
    ctx.lineTo(x - 15, y - 3);
    ctx.lineTo(x - 15, y + 3);
    ctx.lineTo(x - 7, y + 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 9, y - 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a3630";
    ctx.beginPath();
    ctx.moveTo(x + 11.5, y - 3);
    ctx.lineTo(x + 17, y - 1);
    ctx.lineTo(x + 11.5, y);
    ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.quadraticCurveTo(x + 2, y + lift - 2, x - 8, y + lift + 1);
    ctx.quadraticCurveTo(x - 2, y + lift * 0.5, x + 5, y + 1);
    ctx.fill();
  }
  return element;
}

// --- Waldleute --------------------------------------------------------------

export const workerFrame = { w: 30, h: 44, ax: 15, ay: 41 };

/**
 * A Waldmensch facing right: stand, two walking frames, two chopping frames.
 * A Waldfrau wears a long dress and a kerchief instead of tunic and hat.
 */
export function workerAtlas(woman = false): HTMLCanvasElement {
  const { element, ctx } = canvas(workerFrame.w * 5, workerFrame.h);
  for (let f = 0; f < 5; f++) {
    const o = f * workerFrame.w;
    const x = o + workerFrame.ax;
    const y = workerFrame.ay;
    ellipse(ctx, x + 2, y, 8, 3, "rgba(0, 0, 0, 0.3)");
    const stride = f === 1 ? 3 : f === 2 ? -3 : 0;
    ctx.strokeStyle = "#3d3024";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(x - 1.5, y - 13);
    ctx.lineTo(x - 1.5 + stride, y - 1);
    ctx.moveTo(x + 1.8, y - 13);
    ctx.lineTo(x + 1.8 - stride, y - 1);
    ctx.stroke();
    // Tunic with a belt, or a long dress with an apron.
    const tunic = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
    tunic.addColorStop(0, woman ? "#4f7aa8" : "#c55a3a");
    tunic.addColorStop(1, woman ? "#2c4a6e" : "#7d2f1e");
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.moveTo(x - 5.5, y - 25);
    ctx.lineTo(x + 5.5, y - 25);
    ctx.lineTo(x + (woman ? 7.5 : 6.5), y - (woman ? 4 : 11));
    ctx.lineTo(x - (woman ? 7.5 : 6.5), y - (woman ? 4 : 11));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = woman ? "#efe6d2" : "#4a3320";
    if (woman) ctx.fillRect(x - 3, y - 19, 6, 13);
    else ctx.fillRect(x - 6, y - 16, 12, 2);
    // Head and hat.
    const head = ctx.createRadialGradient(x - 1.5, y - 30, 1, x, y - 29, 5);
    head.addColorStop(0, "#f2cfa6");
    head.addColorStop(1, "#c08860");
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, y - 29, 4.4, 0, Math.PI * 2);
    ctx.fill();
    if (woman) {
      // A kerchief over the hair.
      ctx.fillStyle = "#6b4423";
      ctx.beginPath();
      ctx.ellipse(x - 3.5, y - 27, 2, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d8a23a";
      ctx.beginPath();
      ctx.arc(x, y - 30, 4.8, Math.PI * 0.95, Math.PI * 2.05);
      ctx.lineTo(x - 5, y - 27);
      ctx.fill();
    } else {
      ctx.fillStyle = "#2f5a32";
      ctx.beginPath();
      ctx.ellipse(x, y - 32.5, 6.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3d7341";
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 33);
      ctx.quadraticCurveTo(x, y - 41, x + 4, y - 33);
      ctx.fill();
    }
    // The axe: on the shoulder, raised, or swung.
    ctx.save();
    ctx.translate(x + 4, y - 22);
    ctx.rotate(f === 3 ? -2.2 : f === 4 ? 0.9 : -0.5);
    ctx.strokeStyle = "#8a5a32";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -15);
    ctx.stroke();
    ctx.fillStyle = "#c9ced6";
    ctx.beginPath();
    ctx.moveTo(-1, -15);
    ctx.lineTo(5, -17);
    ctx.lineTo(5, -10);
    ctx.lineTo(-1, -11);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#e0b48a";
    ctx.beginPath();
    ctx.arc(x + 4, y - 21, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  return element;
}

// --- Buildings ------------------------------------------------------------

/** Paints in a footprint's own tile coordinates (u right-down, v left-down, z up). */
export class Painter {
  constructor(
    readonly ctx: Ctx,
    readonly ox: number,
    readonly oy: number,
  ) {}

  p(u: number, v: number, z = 0): [number, number] {
    return [this.ox + ((u - v) * TW) / 2, this.oy + ((u + v) * TH) / 2 - z];
  }

  path(points: Point[]) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach(([u, v, z], i) => {
      const [x, y] = this.p(u, v, z);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  poly(
    points: Point[],
    fill: string | CanvasGradient,
    line?: string,
    width = 0.8,
  ) {
    this.path(points);
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    if (line) {
      this.ctx.strokeStyle = line;
      this.ctx.lineWidth = width;
      this.ctx.stroke();
    }
  }

  line(a: Point, b: Point, color: string, width = 0.8) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...this.p(...a));
    ctx.lineTo(...this.p(...b));
    ctx.stroke();
  }

  /** A soft shadow on the ground, cast to the lower right. */
  shadow(u0: number, v0: number, u1: number, v1: number, reach: number) {
    this.poly(
      [
        [u0 + 0.1, v0, 0],
        [u1 + reach, v0 + reach * 0.4, 0],
        [u1 + reach, v1 + reach * 0.6, 0],
        [u0 + 0.2, v1 + 0.2, 0],
      ],
      "rgba(10, 25, 12, 0.28)",
    );
  }

  /** A box; the faces at v = v1 (left) and u = u1 (right) are visible. */
  box(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    z0: number,
    z1: number,
    c: { top: string; left: string; right: string; line?: string },
  ) {
    this.poly(
      [
        [u0, v1, z0],
        [u1, v1, z0],
        [u1, v1, z1],
        [u0, v1, z1],
      ],
      c.left,
      c.line,
    );
    this.poly(
      [
        [u1, v0, z0],
        [u1, v1, z0],
        [u1, v1, z1],
        [u1, v0, z1],
      ],
      c.right,
      c.line,
    );
    this.poly(
      [
        [u0, v0, z1],
        [u1, v0, z1],
        [u1, v1, z1],
        [u0, v1, z1],
      ],
      c.top,
      c.line,
    );
  }

  /** Lines across a slope, parallel to its ridge. */
  courses(
    eaveA: Point,
    eaveB: Point,
    ridgeB: Point,
    ridgeA: Point,
    count: number,
    color: string,
  ) {
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const lerp = (a: Point, b: Point): Point => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      this.line(lerp(eaveA, ridgeA), lerp(eaveB, ridgeB), color, 0.7);
    }
  }

  /** A gabled roof with its ridge along u or v. */
  gable(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    z: number,
    rise: number,
    axis: "u" | "v",
    c: { lit: string; dark: string; gable: string; courses: string },
    over = 0.15,
  ) {
    const top = z + rise;
    if (axis === "u") {
      const vm = (v0 + v1) / 2;
      const back: Point[] = [
        [u0 - over, v0 - over, z],
        [u1 + over, v0 - over, z],
        [u1 + over, vm, top],
        [u0 - over, vm, top],
      ];
      const front: Point[] = [
        [u0 - over, v1 + over, z],
        [u1 + over, v1 + over, z],
        [u1 + over, vm, top],
        [u0 - over, vm, top],
      ];
      this.poly(back, c.lit, c.courses);
      this.poly(
        [
          [u1, v0, z],
          [u1, v1, z],
          [u1, vm, top],
        ],
        c.gable,
        c.courses,
      );
      this.poly(front, c.dark, c.courses);
      this.courses(front[0], front[1], front[2], front[3], 6, c.courses);
      this.line(
        [u0 - over, vm, top],
        [u1 + over, vm, top],
        shade(c.dark, -0.35),
        1.4,
      );
    } else {
      const um = (u0 + u1) / 2;
      const back: Point[] = [
        [u0 - over, v0 - over, z],
        [u0 - over, v1 + over, z],
        [um, v1 + over, top],
        [um, v0 - over, top],
      ];
      const front: Point[] = [
        [u1 + over, v0 - over, z],
        [u1 + over, v1 + over, z],
        [um, v1 + over, top],
        [um, v0 - over, top],
      ];
      this.poly(back, c.lit, c.courses);
      this.courses(back[0], back[1], back[2], back[3], 6, c.courses);
      this.poly(
        [
          [u0, v1, z],
          [u1, v1, z],
          [um, v1, top],
        ],
        c.gable,
        c.courses,
      );
      this.poly(front, c.dark, c.courses);
      this.courses(front[0], front[1], front[2], front[3], 6, c.courses);
      this.line(
        [um, v0 - over, top],
        [um, v1 + over, top],
        shade(c.dark, -0.35),
        1.4,
      );
    }
  }

  /** A pyramid roof over u0..u1 × v0..v1, rising from z by rise. */
  pyramid(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    z: number,
    rise: number,
    c: { lit: string; dark: string; courses: string },
    over = 0.12,
  ) {
    const [a, b, e, f] = [u0 - over, v0 - over, u1 + over, v1 + over];
    const apex: Point = [(u0 + u1) / 2, (v0 + v1) / 2, z + rise];
    this.poly([[a, b, z], [e, b, z], apex], c.lit, c.courses);
    this.poly([[a, b, z], [a, f, z], apex], c.lit, c.courses);
    this.poly([[a, f, z], [e, f, z], apex], c.dark, c.courses);
    this.poly([[e, b, z], [e, f, z], apex], shade(c.dark, -0.15), c.courses);
  }

  /** A pennant on a pole standing at (u, v, z), blowing to the right. */
  pennant(u: number, v: number, z: number, height: number, colors: string[]) {
    const ctx = this.ctx;
    const [x, y] = this.p(u, v, z);
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - height);
    ctx.stroke();
    const top = y - height;
    colors.forEach((color, i) => {
      const k = i / colors.length;
      const k1 = (i + 1) / colors.length;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 22 * k, top + 1 + 4 * k);
      ctx.lineTo(x + 22 * k1, top + 1 + 4 * k1);
      ctx.lineTo(x + 22 * k1, top + 13 - 4 * k1);
      ctx.lineTo(x + 22 * k, top + 13 - 4 * k);
      ctx.fill();
    });
  }

  /** A torch on a post: a warm glow. */
  torch(u: number, v: number, z: number) {
    const ctx = this.ctx;
    const [x, y] = this.p(u, v, z);
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 16);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, y - 19, 0, x, y - 19, 9);
    g.addColorStop(0, "rgba(255, 236, 160, 0.95)");
    g.addColorStop(0.4, "rgba(255, 160, 50, 0.7)");
    g.addColorStop(1, "rgba(255, 120, 30, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - 19, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A window or door on the left face (v = v) between u0..u1 and z0..z1. */
  leftOpening(
    v: number,
    u0: number,
    u1: number,
    z0: number,
    z1: number,
    fill: string,
    frame = "#4a3320",
  ) {
    this.poly(
      [
        [u0, v, z0],
        [u1, v, z0],
        [u1, v, z1],
        [u0, v, z1],
      ],
      fill,
      frame,
      1,
    );
  }

  /** A window or door on the right face (u = u) between v0..v1 and z0..z1. */
  rightOpening(
    u: number,
    v0: number,
    v1: number,
    z0: number,
    z1: number,
    fill: string,
    frame = "#4a3320",
  ) {
    this.poly(
      [
        [u, v0, z0],
        [u, v1, z0],
        [u, v1, z1],
        [u, v0, z1],
      ],
      fill,
      frame,
      1,
    );
  }
}

/** Room above the footprint for walls, roofs, towers and flags. */
const heights: Record<Kind, number> = {
  huette: 70,
  schafweide: 50,
  druckerei: 96,
  spielhaus: 160,
  bibliothek: 110,
  klause: 90,
  steinbruch: 100,
  theater: 130,
  kloster: 190,
  damm: 50,
  bruecke: 34,
  hafen: 80,
  schiff: 70,
  steinhaus: 110,
  getreidehof: 60,
  viehhof: 70,
  muehle: 90,
  baeckerei: 90,
  brauerei: 90,
  kirche: 170,
  friedhof: 50,
  ise: 90,
  brot: 70,
};

function painter(kind: Kind, w: number, d: number) {
  const pad = 10;
  const up = heights[kind];
  const W = ((w + d) * TW) / 2 + pad * 2;
  const H = ((w + d) * TH) / 2 + up + pad * 2;
  const { element, ctx } = canvas(W, H);
  const ox = (d * TW) / 2 + pad;
  const oy = up + pad;
  const centre = { x: ox + ((w - d) * TW) / 4, y: oy + ((w + d) * TH) / 4 };
  return { element, P: new Painter(ctx, ox, oy), ax: centre.x, ay: centre.y };
}

const plaster = {
  top: "#efe4cc",
  left: "#e3d3b0",
  right: "#bba57f",
  line: "#8f7a58",
};
const logs = {
  top: "#a87a4c",
  left: "#9a6a3c",
  right: "#6e4a28",
  line: "#4a3320",
};
const stone = {
  top: "#cfc7b4",
  left: "#c2b8a1",
  right: "#958b76",
  line: "#6f6656",
};
const thatch = {
  lit: "#d9b45e",
  dark: "#a8833a",
  gable: "#9a6a3c",
  courses: "#86662c",
};
const tiles = {
  lit: "#c25a3c",
  dark: "#8f3a26",
  gable: "#e3d3b0",
  courses: "#6e2a1b",
};
const slate = {
  lit: "#7c8796",
  dark: "#4f5967",
  gable: "#c2b8a1",
  courses: "#3a424d",
};
const glass = "#3b4a5a";
const glow = "#f0d27a";

function timber(
  P: Painter,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  z0: number,
  z1: number,
) {
  const dark = "#5a3a22";
  const mid = (z0 + z1) / 2;
  for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / 4)
    P.line([u, v1, z0], [u, v1, z1], dark, 1.4);
  for (let v = v0; v <= v1 + 0.01; v += (v1 - v0) / 4)
    P.line([u1, v, z0], [u1, v, z1], dark, 1.4);
  P.line([u0, v1, mid], [u1, v1, mid], dark, 1.4);
  P.line([u1, v0, mid], [u1, v1, mid], dark, 1.4);
  P.line([u0, v1, z0], [u0 + (u1 - u0) / 4, v1, mid], dark, 1.2);
  P.line([u1, v0, z0], [u1, v0 + (v1 - v0) / 4, mid], dark, 1.2);
}

/** The serif of the site's texts, which every system has. */
const signFont = 'Georgia, "Times New Roman", serif';

/**
 * A signboard on a front (the left face, v = v) between u0..u1 and z0..z1,
 * with lines of text painted in the face's plane: each line a share of the
 * board's height, all shrunk together until the widest fits.
 */
function frontSign(
  P: Painter,
  v: number,
  u0: number,
  u1: number,
  z0: number,
  z1: number,
  lines: { text: string; size: number; italic?: boolean }[],
  c: { board: string; edge: string; ink: string },
) {
  P.leftOpening(v, u0, u1, z0, z1, c.board, c.edge);
  P.leftOpening(
    v,
    u0 + 0.06,
    u1 - 0.06,
    z0 + 1,
    z1 - 1,
    c.board,
    shade(c.board, 0.25),
  );
  const shown = lines.filter((line) => line.text);
  if (!shown.length) return;
  const ctx = P.ctx;
  const font = (line: (typeof shown)[number], k: number) =>
    `${line.italic ? "italic 600" : "700"} ${line.size * k}px ${signFont}`;
  // Along the face, x runs with u; the board's width on screen is its run in x.
  const room = ((u1 - u0) * TW) / 2 - 5;
  const total = shown.reduce((sum, line) => sum + line.size, 0);
  let k = Math.min(1, (z1 - z0 - 2.5) / (total * 1.1));
  for (const line of shown) {
    ctx.font = font(line, 1);
    k = Math.min(k, room / ctx.measureText(line.text).width);
  }
  const [x, y] = P.p((u0 + u1) / 2, v, (z0 + z1) / 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, TH / TW, 0, 1, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let top = (-total * k * 1.1) / 2;
  for (const line of shown) {
    const height = line.size * k * 1.1;
    const middle = top + height / 2;
    ctx.font = font(line, k);
    // Letters cut into the board, then painted.
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillText(line.text, 0.4, middle + 0.5);
    ctx.fillStyle = c.ink;
    ctx.fillText(line.text, 0, middle);
    top += height;
  }
  ctx.restore();
}

function hut(P: Painter) {
  P.shadow(0.2, 0.2, 1.8, 1.8, 0.9);
  P.box(0.25, 0.3, 1.75, 1.75, 0, 20, logs);
  for (let z = 4; z < 20; z += 4) {
    P.line([0.25, 1.75, z], [1.75, 1.75, z], "#5a3c22", 0.8);
    P.line([1.75, 0.3, z], [1.75, 1.75, z], "#4a3018", 0.8);
  }
  P.leftOpening(1.75, 0.8, 1.15, 0, 13, "#3a2614");
  P.rightOpening(1.75, 0.7, 1.1, 8, 14, glass);
  P.box(1.25, 0.45, 1.45, 0.65, 20, 44, stone);
  P.gable(0.25, 0.3, 1.75, 1.75, 20, 22, "u", thatch, 0.18);
}

const gameColours: Record<string, [string, string]> = {
  "moto-devil": ["#c23b2a", "#f4d24a"],
  "car-drive": ["#2a62b8", "#f2f2f2"],
};

function spielhaus(P: Painter, title: string, game?: string) {
  const [flag, sign] = gameColours[game ?? ""] ?? ["#b0782e", "#f0e0b0"];
  P.shadow(0.2, 0.2, 2.8, 2.8, 1.3);
  P.box(0.3, 0.3, 2.7, 2.7, 0, 3, stone);
  P.box(0.35, 0.35, 2.65, 2.65, 3, 36, plaster);
  timber(P, 0.35, 0.35, 2.65, 2.65, 3, 36);
  P.leftOpening(2.65, 1.25, 1.75, 3, 22, "#4a2f1c");
  for (const u of [0.6, 2.05]) P.leftOpening(2.65, u, u + 0.4, 14, 26, glow);
  for (const v of [0.6, 1.4, 2.05])
    P.rightOpening(2.65, v, v + 0.35, 14, 26, glass);
  // The game's name over the door.
  frontSign(P, 2.65, 0.45, 2.55, 27, 35.5, [{ text: title, size: 9 }], {
    board: flag,
    edge: "#3a2614",
    ink: sign,
  });
  P.gable(0.35, 0.35, 2.65, 2.65, 36, 34, "v", tiles, 0.2);
  // A flag in the game's colours on the roof.
  const [fx, fy] = P.p(1.5, 0.6, 70);
  const ctx = P.ctx;
  ctx.strokeStyle = "#3a2614";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(fx, fy + 22);
  ctx.lineTo(fx, fy - 18);
  ctx.stroke();
  ctx.fillStyle = flag;
  ctx.beginPath();
  ctx.moveTo(fx, fy - 18);
  ctx.quadraticCurveTo(fx + 10, fy - 20, fx + 20, fy - 14);
  ctx.lineTo(fx + 20, fy - 6);
  ctx.quadraticCurveTo(fx + 10, fy - 11, fx, fy - 8);
  ctx.fill();
  ctx.fillStyle = sign;
  ctx.fillRect(fx + 2, fy - 14, 14, 2);
}

const redTiles = {
  lit: "#c8402e",
  dark: "#8c2a1e",
  gable: "#efe4cc",
  courses: "#5e1c14",
};
const blueSlate = {
  lit: "#4f7fc0",
  dark: "#2c5490",
  gable: "#e3d3b0",
  courses: "#1d3a66",
};

/** An arched opening on the left face, with a lit or dark inside. */
function leftArch(
  P: Painter,
  v: number,
  u0: number,
  u1: number,
  z0: number,
  z1: number,
  fill: string,
) {
  const ctx = P.ctx;
  const um = (u0 + u1) / 2;
  const r = ((u1 - u0) * TW) / 4;
  ctx.beginPath();
  ctx.moveTo(...P.p(u0, v, z0));
  ctx.lineTo(...P.p(u0, v, z1 - r));
  const [mx, my] = P.p(um, v, z1 - r);
  ctx.ellipse(mx, my, r * 1.12, r, Math.atan2(TH, TW), Math.PI, 0);
  ctx.lineTo(...P.p(u1, v, z0));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#3a2614";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** Battlements along the top of a box's two visible faces. */
function crenels(
  P: Painter,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  z: number,
  c: { top: string; left: string; right: string; line?: string },
) {
  const step = 0.3;
  for (let u = u0; u < u1 - 0.05; u += step * 2)
    P.box(u, v1 - 0.18, Math.min(u1, u + step), v1, z, z + 6, c);
  for (let v = v0; v < v1 - 0.05; v += step * 2)
    P.box(u1 - 0.18, v, u1, Math.min(v1, v + step), z, z + 6, c);
}

/**
 * Moto Devil's house: the devil's keep. A timber-framed hall with a tall
 * stone tower, red roofs, banners in the game's red and gold, and a wooden
 * jump ramp leaning against the tower.
 */
function motoHouse(P: Painter, title: string) {
  const red = "#c23b2a";
  const gold = "#f4d24a";
  P.shadow(0.2, 0.2, 4.7, 3.6, 1.8);
  P.box(0.2, 0.2, 4.8, 3.6, 0, 3, stone);
  // The hall.
  P.box(0.4, 0.5, 3.0, 3.3, 3, 40, plaster);
  timber(P, 0.4, 0.5, 3.0, 3.3, 3, 40);
  leftArch(P, 3.3, 1.2, 2.1, 3, 26, glow);
  for (const v of [0.8, 1.6, 2.4])
    P.rightOpening(3.0, v, v + 0.35, 18, 30, glass);
  // Banners hanging on the hall's front, under the game's name.
  for (const u of [0.6, 2.35]) {
    P.leftOpening(3.3, u, u + 0.4, 9, 28, red, "#5e1c14");
    P.leftOpening(3.3, u + 0.12, u + 0.28, 9, 28, gold, red);
  }
  frontSign(P, 3.3, 0.5, 2.9, 26.5, 37.5, [{ text: title, size: 10 }], {
    board: "#3a1a10",
    edge: "#5e1c14",
    ink: gold,
  });
  P.gable(0.4, 0.5, 3.0, 3.3, 40, 36, "v", redTiles, 0.2);
  // The tower, with battlements and a tall roof.
  P.box(3.0, 0.4, 4.5, 1.9, 0, 86, stone);
  for (let z = 10; z < 86; z += 12) {
    P.line([3.0, 1.9, z], [4.5, 1.9, z], "#8f8572", 0.8);
    P.line([4.5, 0.4, z], [4.5, 1.9, z], "#7a705e", 0.8);
  }
  for (const z of [30, 56]) {
    P.leftOpening(1.9, 3.55, 3.95, z, z + 12, glow);
    P.rightOpening(4.5, 0.95, 1.35, z, z + 12, glass);
  }
  crenels(P, 3.0, 0.4, 4.5, 1.9, 86, stone);
  P.pyramid(3.1, 0.5, 4.4, 1.8, 92, 40, redTiles, 0.05);
  P.pennant(3.75, 1.15, 132, 26, [red, gold, red]);
  // The jump ramp in front of the tower.
  const ramp = {
    top: "#c0915a",
    left: "#8a5a32",
    right: "#6b4423",
    line: "#4a3320",
  };
  P.poly(
    [
      [3.3, 2.2, 0],
      [4.6, 2.2, 0],
      [4.6, 2.2, 22],
    ],
    ramp.right,
    ramp.line,
  );
  P.poly(
    [
      [3.3, 2.2, 0],
      [3.3, 3.3, 0],
      [4.6, 3.3, 22],
      [4.6, 2.2, 22],
    ],
    ramp.top,
    ramp.line,
  );
  for (let k = 1; k < 6; k++) {
    const u = 3.3 + (1.3 * k) / 6;
    P.line([u, 2.2, (22 * k) / 6], [u, 3.3, (22 * k) / 6], "#8a5a32", 0.8);
  }
  P.poly(
    [
      [4.6, 2.2, 0],
      [4.6, 3.3, 0],
      [4.6, 3.3, 22],
      [4.6, 2.2, 22],
    ],
    ramp.right,
    ramp.line,
  );
  P.torch(0.3, 3.5, 3);
  P.torch(3.15, 3.5, 3);
}

/**
 * Car Drive's house: a coach house for wagons, with two wide gates, a blue
 * slate roof with a lantern turret, a cart wheel over the gates and pennants
 * in the game's blue and white.
 */
function carHouse(P: Painter, title: string) {
  const blue = "#2a62b8";
  const white = "#f2f2f2";
  P.shadow(0.2, 0.2, 4.8, 3.6, 1.6);
  P.box(0.2, 0.3, 4.8, 3.6, 0, 3, stone);
  P.box(0.4, 0.5, 4.6, 3.3, 3, 36, logs);
  for (let z = 7; z < 36; z += 4) {
    P.line([0.4, 3.3, z], [4.6, 3.3, z], "#5a3c22", 0.8);
    P.line([4.6, 0.5, z], [4.6, 3.3, z], "#4a3018", 0.8);
  }
  // Two wide gates, open onto a lit inside.
  for (const u of [0.8, 2.75]) {
    leftArch(P, 3.3, u, u + 1.45, 3, 28, "#4a2f1c");
    leftArch(P, 3.3, u + 0.12, u + 1.33, 3, 26, glow);
  }
  // A cart wheel over the gates.
  const ctx = P.ctx;
  const [wx, wy] = P.p(2.5, 3.3, 31);
  ctx.save();
  ctx.translate(wx, wy);
  ctx.transform(1, 0.5, 0, 1, 0, 0);
  ctx.strokeStyle = "#3a2614";
  ctx.fillStyle = "#c9a46c";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, -2, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 8, -2 + Math.sin(a) * 8);
    ctx.lineTo(-Math.cos(a) * 8, -2 - Math.sin(a) * 8);
    ctx.stroke();
  }
  ctx.restore();
  for (const v of [0.8, 1.7, 2.5])
    P.rightOpening(4.6, v, v + 0.35, 16, 28, glass);
  P.gable(0.4, 0.5, 4.6, 3.3, 36, 30, "u", blueSlate, 0.2);
  // The game's name on a board standing on the roof, over the gates.
  for (const u of [1.3, 3.7])
    P.line([u, 3.4, 36], [u, 3.4, 42], "#3a2614", 1.6);
  frontSign(P, 3.4, 1.0, 4.0, 41, 53, [{ text: title, size: 10 }], {
    board: blue,
    edge: "#1d3a66",
    ink: white,
  });
  // The lantern turret on the ridge.
  P.box(2.2, 1.6, 2.8, 2.2, 58, 74, plaster);
  P.leftOpening(2.2, 2.35, 2.65, 61, 71, glow);
  P.rightOpening(2.8, 1.75, 2.05, 61, 71, glow);
  P.pyramid(2.2, 1.6, 2.8, 2.2, 74, 20, blueSlate, 0.1);
  P.pennant(2.5, 1.9, 94, 22, [blue, white, blue]);
  P.pennant(0.3, 3.5, 3, 46, [blue, white]);
  P.pennant(4.7, 3.5, 3, 46, [white, blue]);
}

/**
 * Meinrad's hermitage: a small log cell under a shingle roof, a stack of
 * firewood and a stump by the door, without religious symbols.
 */
function klause(P: Painter) {
  const shingles = {
    lit: "#8a7a62",
    dark: "#5e5242",
    gable: "#9a6a3c",
    courses: "#463c30",
  };
  P.shadow(0.3, 0.3, 2.7, 2.7, 1.1);
  P.box(0.5, 0.5, 2.3, 2.2, 0, 22, logs);
  for (let z = 4; z < 22; z += 3.6) {
    P.line([0.5, 2.2, z], [2.3, 2.2, z], "#5a3c22", 0.8);
    P.line([2.3, 0.5, z], [2.3, 2.2, z], "#4a3018", 0.8);
  }
  P.leftOpening(2.2, 1.0, 1.4, 0, 14, "#2e1e10");
  P.rightOpening(2.3, 1.0, 1.35, 9, 15, glow);
  P.gable(0.5, 0.5, 2.3, 2.2, 22, 20, "v", shingles, 0.22);
  // Firewood and a stump.
  for (let k = 0; k < 3; k++)
    P.box(0.55, 2.35 + k * 0.01, 1.0, 2.75, k * 4, k * 4 + 4, {
      top: "#c9a46c",
      left: "#8a5a32",
      right: "#6b4423",
      line: "#4a3320",
    });
  const [sx, sy] = P.p(2.5, 2.6, 0);
  ellipse(P.ctx, sx, sy - 4, 7, 3.5, "#5a3c22");
  ellipse(P.ctx, sx, sy - 8, 7, 3.5, "#c9a46c");
}

/**
 * A quarry: a cut rock face at the back, dressed blocks stacked in front, and
 * a wooden hoist with a block on its rope.
 */
function steinbruch(P: Painter, w: number, d: number) {
  const rock = {
    top: "#bdb8ad",
    left: "#a29d92",
    right: "#7d796f",
    line: "#5f5b53",
  };
  const block = {
    top: "#ddd8cc",
    left: "#c4beb1",
    right: "#9e988b",
    line: "#6f6a60",
  };
  P.poly(
    [
      [0, 0, 0],
      [w, 0, 0],
      [w, d, 0],
      [0, d, 0],
    ],
    "#c9c2b0",
  );
  const rnd = random(9);
  for (let i = 0; i < 160; i++) {
    const [x, y] = P.p(rnd() * w, rnd() * d);
    P.ctx.fillStyle =
      rnd() < 0.5 ? "rgba(90, 85, 75, 0.4)" : "rgba(255, 250, 235, 0.4)";
    P.ctx.fillRect(x, y, 1.6, 1.2);
  }
  P.shadow(0.1, 0.1, w - 0.2, 1.2, 1.4);
  // The rock face, cut in steps.
  for (const [u0, v0, u1, v1, z] of [
    [0.1, 0.1, 1.4, 0.9, 46],
    [1.3, 0.1, 2.6, 0.7, 36],
    [2.5, 0.1, w - 0.1, 1.0, 54],
    [0.1, 0.8, 0.8, 1.9, 28],
  ]) {
    P.box(u0, v0, u1, v1, 0, z, rock);
    for (let k = 8; k < z; k += 9) {
      P.line([u0, v1, k], [u1, v1, k], "#8a857a", 0.7);
      P.line([u1, v0, k], [u1, v1, k], "#6a665d", 0.7);
    }
  }
  // Dressed blocks waiting to be carted off.
  P.box(1.4, 1.6, 2.0, 2.2, 0, 9, block);
  P.box(2.1, 1.7, 2.7, 2.3, 0, 9, block);
  P.box(1.7, 1.7, 2.3, 2.2, 9, 18, block);
  P.box(0.5, 2.2, 1.1, 2.7, 0, 8, block);
  // The hoist: two legs, a beam, the rope and a block.
  const log = "#7a4e26";
  P.line([3.0, 1.5, 0], [3.25, 1.9, 56], log, 2.6);
  P.line([3.5, 2.3, 0], [3.25, 1.9, 56], log, 2.6);
  P.line([3.25, 1.9, 56], [2.6, 1.9, 60], log, 2.2);
  P.line([2.6, 1.9, 60], [2.6, 1.9, 26], "#3a2a1e", 0.8);
  P.box(2.45, 1.75, 2.75, 2.05, 18, 26, block);
}

function druckerei(P: Painter) {
  P.shadow(0.2, 0.2, 2.8, 2.8, 1.4);
  P.box(0.3, 0.3, 2.7, 2.7, 0, 34, stone);
  const rnd = random(5);
  for (let i = 0; i < 70; i++) {
    const u = 0.4 + rnd() * 2.2;
    const z = 2 + rnd() * 30;
    P.line([u, 2.7, z], [Math.min(2.7, u + 0.18), 2.7, z], "#8f8572", 1);
    const v = 0.4 + rnd() * 2.2;
    P.line([2.7, v, z], [2.7, Math.min(2.7, v + 0.18), z], "#7a705e", 1);
  }
  P.leftOpening(2.7, 1.2, 1.7, 0, 20, "#3a2a1e");
  for (const u of [0.5, 2.0]) P.leftOpening(2.7, u, u + 0.4, 14, 26, glow);
  for (const v of [0.6, 1.4, 2.05])
    P.rightOpening(2.7, v, v + 0.35, 14, 26, glass);
  P.gable(0.3, 0.3, 2.7, 2.7, 34, 30, "u", slate, 0.2);
  P.box(0.7, 0.6, 1.0, 0.9, 40, 82, { ...stone, top: "#4a443c" });
  // Printed sheets drying on a line by the wall.
  P.line([0.4, 3.0, 22], [2.6, 3.0, 22], "#3a2a1e", 0.8);
  for (let i = 0; i < 4; i++) {
    const u = 0.55 + i * 0.5;
    P.poly(
      [
        [u, 3.0, 22],
        [u + 0.35, 3.0, 22],
        [u + 0.35, 3.0, 12],
        [u, 3.0, 12],
      ],
      "#f7f2e4",
      "#b9ae94",
    );
    P.line([u + 0.06, 3.0, 19], [u + 0.28, 3.0, 19], "#2a2420", 1);
    P.line([u + 0.06, 3.0, 16], [u + 0.25, 3.0, 16], "#7a7064", 0.8);
  }
  bookStack(P, 2.75, 1.0, 3);
}

const bookColours = ["#8c2a1e", "#2f5d34", "#2c5490", "#7a4e26", "#5e3a6e"];

/** A stack of bound books on the ground beside (u, v). */
function bookStack(P: Painter, u: number, v: number, count: number) {
  for (let k = 0; k < count; k++) {
    const colour = bookColours[k % bookColours.length];
    const shift = (k % 2) * 0.04;
    P.box(u + shift, v, u + 0.32 + shift, v + 0.22, k * 2.6, k * 2.6 + 2.6, {
      top: shade(colour, 0.15),
      left: "#f2ead6",
      right: colour,
      line: shade(colour, -0.4),
    });
  }
}

/**
 * A game's library, where its source code lies: a stone hall with tall
 * arched windows, pilasters by the door, a slate roof, the game's name and
 * «Quellcode» on a board over the door, and books stacked outside.
 */
function bibliothek(P: Painter, title: string, game?: string) {
  const [colour, ink] = gameColours[game ?? ""] ?? ["#5a3a22", "#f0e0b0"];
  P.shadow(0.2, 0.2, 3.8, 2.7, 1.4);
  P.box(0.2, 0.2, 3.8, 2.8, 0, 3, stone);
  P.box(0.35, 0.35, 3.65, 2.5, 3, 46, stone);
  for (let z = 9; z < 46; z += 6) {
    P.line([0.35, 2.5, z], [3.65, 2.5, z], "#a89e88", 0.7);
    P.line([3.65, 0.35, z], [3.65, 2.5, z], "#857b67", 0.7);
  }
  for (const u of [0.6, 3.0]) leftArch(P, 2.5, u, u + 0.4, 9, 36, glow);
  leftArch(P, 2.5, 1.75, 2.25, 3, 24, "#4a2f1c");
  const pilaster = { ...stone, top: "#ddd6c4", left: "#d3cab4" };
  for (const u of [1.45, 2.4]) P.box(u, 2.5, u + 0.15, 2.62, 3, 44, pilaster);
  for (const v of [0.65, 1.4]) P.rightOpening(3.65, v, v + 0.4, 12, 34, glow);
  frontSign(
    P,
    2.62,
    1.05,
    2.95,
    27,
    43,
    [
      { text: title, size: 9 },
      { text: "Quellcode", size: 6, italic: true },
    ],
    { board: colour, edge: "#3a2614", ink },
  );
  P.gable(0.35, 0.35, 3.65, 2.5, 46, 26, "u", slate, 0.2);
  bookStack(P, 0.55, 2.7, 4);
  bookStack(P, 2.95, 2.75, 2);
}

function sheep(P: Painter, u: number, v: number, rnd: () => number) {
  const [x, y] = P.p(u, v, 0);
  const ctx = P.ctx;
  ellipse(ctx, x + 3, y + 1, 8, 3, "rgba(0, 0, 0, 0.25)");
  for (let k = 0; k < 6; k++) {
    const cx = x - 4 + k * 1.6;
    const cy = y - 7 - (k % 2) * 2 - rnd();
    const g = ctx.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, 4);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#cfc8b8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#3a3330";
  ctx.beginPath();
  ctx.ellipse(x + 6, y - 8, 2.6, 2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 3, y - 4, 1.2, 4);
  ctx.fillRect(x + 3, y - 4, 1.2, 4);
}

function schafweide(P: Painter, w: number, d: number) {
  P.poly(
    [
      [0.1, 0.1, 0],
      [w - 0.1, 0.1, 0],
      [w - 0.1, d - 0.1, 0],
      [0.1, d - 0.1, 0],
    ],
    "#86b356",
  );
  const rnd = random(9);
  for (let i = 0; i < 160; i++) {
    const [x, y] = P.p(0.2 + rnd() * (w - 0.4), 0.2 + rnd() * (d - 0.4));
    P.ctx.fillStyle =
      rnd() < 0.5 ? "rgba(255,255,200,0.25)" : "rgba(30,70,20,0.25)";
    P.ctx.fillRect(x, y, 1.5, 1);
  }
  // A shelter in the back corner.
  P.box(w - 1.4, 0.2, w - 0.2, 1.2, 0, 14, logs);
  P.gable(w - 1.4, 0.2, w - 0.2, 1.2, 14, 12, "u", thatch, 0.12);
  // The trough.
  P.box(0.5, d - 0.9, 1.3, d - 0.6, 0, 4, logs);
  P.poly(
    [
      [0.55, d - 0.85, 4],
      [1.25, d - 0.85, 4],
      [1.25, d - 0.65, 4],
      [0.55, d - 0.65, 4],
    ],
    "#4f8fcf",
  );
  const flock: [number, number][] = [
    [0.9, 0.9],
    [1.8, 1.6],
    [2.6, 0.9],
    [2.4, 2.2],
    [1.3, 2.0],
  ];
  flock.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [u, v] of flock) sheep(P, u, v, rnd);
  // Fence posts and rails round the edge, back sides first.
  const post = (u: number, v: number) =>
    P.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 9, logs);
  const rails = (a: [number, number], b: [number, number]) => {
    P.line([a[0], a[1], 7], [b[0], b[1], 7], "#7a5230", 1.2);
    P.line([a[0], a[1], 3.5], [b[0], b[1], 3.5], "#7a5230", 1.2);
  };
  rails([0.1, 0.1], [w - 0.1, 0.1]);
  rails([0.1, 0.1], [0.1, d - 0.1]);
  for (let u = 0.1; u <= w; u += 0.5) post(u, 0.1);
  for (let v = 0.1; v <= d; v += 0.5) post(0.1, v);
  rails([0.1, d - 0.1], [w - 0.1, d - 0.1]);
  rails([w - 0.1, 0.1], [w - 0.1, d - 0.1]);
  for (let u = 0.1; u <= w; u += 0.5) post(u, d - 0.1);
  for (let v = 0.1; v <= d; v += 0.5) post(w - 0.1, v);
}

/** The bands of the stands round the stage: row r, its back, sides and front. */
export function standBands(w: number, d: number) {
  const S = STAGE;
  const gap = 0.12;
  const bands = [];
  for (let r = 0; r < S.rows; r++) {
    const inner = gap + r * S.row;
    const outer = gap + (r + 1) * S.row;
    const u0 = Math.max(0.1, S.u0 - outer);
    const u1 = Math.min(w - 0.1, S.u1 + outer);
    const back = { u0, u1, v0: Math.max(0.1, S.v0 - outer), v1: S.v0 - inner };
    const front = {
      u0,
      u1,
      v0: S.v1 + inner,
      v1: Math.min(d - 0.1, S.v1 + outer),
    };
    bands.push({
      r,
      back,
      left: { u0, u1: S.u0 - inner, v0: back.v1, v1: front.v0 },
      right: { u0: S.u1 + inner, u1, v0: back.v1, v1: front.v0 },
      front,
      height: 8 + r * 9,
    });
  }
  return bands;
}

/** Which stand a spectator sits on: back and left face the viewer. */
export type StandSide = "back" | "left" | "right" | "front";

export interface Spectator {
  u: number;
  v: number;
  /** The row's height, in world units. */
  z: number;
  r: number;
  side: StandSide;
  shirt: string;
  skin: string;
  hair: string;
  hat: boolean;
  cheering: boolean;
}

const shirts = [
  "#a8432f",
  "#2f5d34",
  "#2c5490",
  "#c9a046",
  "#6b4a8a",
  "#8a5a32",
  "#d8d0c0",
  "#3a5a6a",
  "#b8323a",
];
const skins = ["#e2b58a", "#d9a477", "#c08a5e", "#f0c9a0", "#a8744a"];
const hairs = [
  "#3a2a1e",
  "#6b4a28",
  "#c9a46c",
  "#2a2420",
  "#8a3a1e",
  "#b0aaa0",
];

/**
 * The theatre's audience: where each spectator sits on the stands and how
 * they look, the same every time, for the isometric and the plan view. Rows
 * are not full; here and there a seat is free. The first front row stays
 * empty, so its heads do not cover the hint lying before the stage.
 */
export function crowd(w: number, d: number): Spectator[] {
  const rnd = random(21);
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const seats: Spectator[] = [];
  for (const band of standBands(w, d)) {
    for (const side of ["back", "left", "right", "front"] as const) {
      if (side === "front" && band.r === 0) continue;
      const b = band[side];
      const alongU = side === "back" || side === "front";
      const [a0, a1] = alongU ? [b.u0, b.u1] : [b.v0, b.v1];
      const across = alongU ? (b.v0 + b.v1) / 2 : (b.u0 + b.u1) / 2;
      for (let a = a0 + 0.22; a < a1 - 0.15; a += 0.3 + rnd() * 0.08) {
        if (rnd() < 0.2) continue;
        const off = across + (rnd() - 0.5) * 0.1;
        seats.push({
          u: alongU ? a : off,
          v: alongU ? off : a,
          z: band.height,
          r: band.r,
          side,
          shirt: pick(shirts),
          skin: pick(skins),
          hair: pick(hairs),
          hat: rnd() < 0.22,
          cheering: rnd() < 0.12,
        });
      }
    }
  }
  return seats;
}

/** A spectator sitting on a row: facing the viewer, or seen from behind. */
function spectator(P: Painter, s: Spectator) {
  const ctx = P.ctx;
  const [x, y] = P.p(s.u, s.v, s.z);
  const toward = s.side === "back" || s.side === "left";
  ellipse(ctx, x + 1, y, 3.6, 1.4, "rgba(30, 20, 10, 0.3)");
  if (toward) {
    // The lap and knees.
    ctx.fillStyle = "#4a3a2e";
    ctx.fillRect(x - 2.6, y - 2.4, 5.2, 2.4);
  }
  if (s.cheering) {
    ctx.strokeStyle = s.shirt;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 2.4, y - 8);
      ctx.lineTo(x + side * 4.2, y - 14);
      ctx.stroke();
      ellipse(ctx, x + side * 4.3, y - 14.6, 1, 1, s.skin);
    }
  }
  ctx.beginPath();
  ctx.moveTo(x - 3.1, y - 1.5);
  ctx.lineTo(x - 2.8, y - 8);
  ctx.quadraticCurveTo(x, y - 9.6, x + 2.8, y - 8);
  ctx.lineTo(x + 3.1, y - 1.5);
  ctx.closePath();
  ctx.fillStyle = s.shirt;
  ctx.fill();
  ctx.strokeStyle = shade(s.shirt, -0.4);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  const hy = y - 11.6;
  if (toward) {
    ellipse(ctx, x, hy, 2.5, 2.6, s.skin);
    ctx.fillStyle = s.hair;
    ctx.beginPath();
    ctx.arc(x, hy - 0.4, 2.6, Math.PI, 0);
    ctx.fill();
  } else {
    ellipse(ctx, x, hy, 2.5, 2.6, s.hair);
  }
  if (s.hat) {
    ellipse(ctx, x, hy - 1.6, 3.4, 1, "#2f5d34");
    ctx.fillStyle = "#2f5d34";
    ctx.fillRect(x - 1.9, hy - 4.2, 3.8, 2.6);
    ctx.fillStyle = "#c9a046";
    ctx.fillRect(x - 1.9, hy - 2.4, 3.8, 0.7);
  }
}

const plank = {
  top: "#b98a52",
  left: "#8a5a32",
  right: "#6b4423",
  line: "#4a3320",
};

/**
 * A wooden amphitheatre: tiered stands all round the stage with an audience
 * on them, a backdrop with red curtains at the stage's back, and pennants and
 * torches round it. The
 * stage itself is left empty: its picture lies on the ground below
 * (stage.ts), so the stands in front of it hide its edge. Painted in two
 * parts, so the preview standing on the stage comes between them: the back
 * (floor, back and left stands, backdrop) and the front (right and front
 * stands, the poles in front).
 */
function theater(
  P: Painter,
  w: number,
  d: number,
  part: "all" | "back" | "front" = "all",
) {
  const S = STAGE;
  const back = part !== "front";
  const front = part !== "back";
  const earth = "#b49a6a";
  for (const [u0, v0, u1, v1] of [
    [0, 0, w, S.v0],
    [0, S.v0, S.u0, S.v1],
    [S.u1, S.v0, w, S.v1],
    [0, S.v1, w, d],
  ])
    if (back)
      P.poly(
        [
          [u0, v0, 0],
          [u1, v0, 0],
          [u1, v1, 0],
          [u0, v1, 0],
        ],
        earth,
      );
  const rnd = random(4);
  for (let i = 0; i < (back ? 220 : 0); i++) {
    const u = rnd() * w;
    const v = rnd() * d;
    if (u > S.u0 && u < S.u1 && v > S.v0 && v < S.v1) continue;
    const [x, y] = P.p(u, v);
    P.ctx.fillStyle = "rgba(90, 70, 40, 0.25)";
    P.ctx.fillRect(x, y, 1.6, 1);
  }
  const bands = standBands(w, d);
  type Box = { u0: number; u1: number; v0: number; v1: number };
  const tier = (b: Box, z: number, along: "u" | "v") => {
    P.box(b.u0, b.v0, b.u1, b.v1, 0, z, plank);
    // Planks along the row, and their shadows.
    const steps = 3;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (along === "u") {
        const v = b.v0 + (b.v1 - b.v0) * t;
        P.line([b.u0, v, z], [b.u1, v, z], "#8a5a32", 0.7);
      } else {
        const u = b.u0 + (b.u1 - b.u0) * t;
        P.line([u, b.v0, z], [u, b.v1, z], "#8a5a32", 0.7);
      }
    }
  };
  const railing = (
    b: Box,
    z: number,
    side: "back" | "left" | "right" | "front",
  ) => {
    const posts: [number, number][] = [];
    if (side === "front" || side === "back") {
      const v = side === "front" ? b.v1 - 0.05 : b.v0 + 0.05;
      for (let u = b.u0 + 0.1; u <= b.u1; u += 0.6) posts.push([u, v]);
    } else {
      const u = side === "left" ? b.u0 + 0.05 : b.u1 - 0.05;
      for (let v = b.v0 + 0.1; v <= b.v1; v += 0.6) posts.push([u, v]);
    }
    for (const [u, v] of posts)
      P.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, z, z + 9, logs);
    const [a, c] = [posts[0], posts[posts.length - 1]];
    P.line([a[0], a[1], z + 8], [c[0], c[1], z + 8], "#5a3a20", 1.2);
  };
  // The audience, row by row, each row from the back of the picture forward.
  const audience = crowd(w, d);
  const seated = (r: number, side: StandSide) =>
    audience
      .filter((s) => s.r === r && s.side === side)
      .sort((a, b) => a.u + a.v - (b.u + b.v))
      .forEach((s) => spectator(P, s));
  const outer = bands.length - 1;
  const top = bands[outer];
  const flags = ["#c23b2a", "#f4d24a", "#2a62b8", "#f2f2f2", "#3f8a4a"];
  // Back to front: the back and left stands from the outside in, then the
  // backdrop and the stage, then the right and front stands from the inside
  // out.
  if (back) {
    for (const band of [...bands].reverse()) {
      tier(band.back, band.height, "u");
      if (band.r === outer) railing(band.back, band.height, "back");
      seated(band.r, "back");
    }
    for (const band of [...bands].reverse()) {
      tier(band.left, band.height, "v");
      if (band.r === outer) railing(band.left, band.height, "left");
      seated(band.r, "left");
    }
    P.pennant(top.back.u0 + 0.1, top.back.v0 + 0.1, top.height, 54, [
      flags[0],
      flags[1],
    ]);
    P.pennant(top.back.u1 - 0.1, top.back.v0 + 0.1, top.height, 54, [
      flags[2],
      flags[3],
    ]);
    P.pennant(top.left.u0 + 0.1, top.front.v0, top.height, 54, [
      flags[4],
      flags[1],
    ]);
    backdrop(P);
  }
  if (front) {
    for (const band of bands) {
      tier(band.right, band.height, "v");
      seated(band.r, "right");
      if (band.r === outer) railing(band.right, band.height, "right");
    }
    for (const band of bands) {
      tier(band.front, band.height, "u");
      seated(band.r, "front");
      if (band.r === outer) railing(band.front, band.height, "front");
    }
    P.pennant(top.right.u1 - 0.1, top.right.v0 + 0.1, top.height, 54, [
      flags[1],
      flags[0],
    ]);
    P.pennant(top.front.u1 - 0.1, top.front.v1 - 0.1, top.height, 54, [
      flags[3],
      flags[2],
    ]);
    for (const [u, v] of [
      [S.u0 - 0.1, S.v1 + 0.1],
      [S.u1 + 0.1, S.v1 + 0.1],
      [S.u1 + 0.1, S.v0 + 0.3],
    ])
      P.torch(u, v, 0);
  }
}

/**
 * The backdrop at the stage's back edge: a timber frame with a painted sky,
 * red curtains drawn to the sides and a pelmet with gold fringe.
 */
function backdrop(P: Painter) {
  const S = STAGE;
  const v = S.v0 + 0.05;
  const u0 = S.u0 + 0.3;
  const u1 = S.u1 - 0.3;
  const height = 62;
  const ctx = P.ctx;
  // The painted sky and hills.
  P.path([
    [u0, v, 0],
    [u1, v, 0],
    [u1, v, height],
    [u0, v, height],
  ]);
  const [, skyTop] = P.p(u0, v, height);
  const [, skyBottom] = P.p(u0, v, 0);
  const sky = ctx.createLinearGradient(0, skyTop, 0, skyBottom);
  sky.addColorStop(0, "#6fa6d8");
  sky.addColorStop(0.7, "#d8e8f0");
  ctx.fillStyle = sky;
  ctx.fill();
  P.poly(
    [
      [u0, v, 0],
      [u0, v, 18],
      [u0 + 1.5, v, 30],
      [u0 + 3.2, v, 16],
      [u0 + 4.6, v, 26],
      [u1, v, 14],
      [u1, v, 0],
    ],
    "#4f7a3a",
  );
  // Curtains, gathered to both sides, and the pelmet.
  for (const [a, b] of [
    [u0, u0 + 1.0],
    [u1 - 1.0, u1],
  ]) {
    P.poly(
      [
        [a, v + 0.02, 0],
        [b, v + 0.02, 0],
        [b, v + 0.02, height],
        [a, v + 0.02, height],
      ],
      "#9c2a32",
      "#5e1820",
    );
    for (let k = 1; k < 4; k++) {
      const u = a + ((b - a) * k) / 4;
      P.line([u, v + 0.02, 2], [u, v + 0.02, height], "#6e1a22", 1.2);
    }
  }
  P.poly(
    [
      [u0, v + 0.03, height - 12],
      [u1, v + 0.03, height - 12],
      [u1, v + 0.03, height],
      [u0, v + 0.03, height],
    ],
    "#b8323a",
    "#5e1820",
  );
  for (let u = u0 + 0.1; u < u1; u += 0.25)
    P.line(
      [u, v + 0.03, height - 12],
      [u, v + 0.03, height - 15],
      "#f0c35a",
      1.6,
    );
  // The timber frame.
  P.box(u0 - 0.2, v - 0.15, u0, v + 0.05, 0, height + 6, logs);
  P.box(u1, v - 0.15, u1 + 0.2, v + 0.05, 0, height + 6, logs);
  P.box(u0 - 0.2, v - 0.15, u1 + 0.2, v + 0.05, height, height + 8, logs);
}

/** The theatre in its two parts, for the preview between them. */
export function theaterParts(w: number, d: number) {
  const parts = (["back", "front"] as const).map((part) => {
    const { element, P, ax, ay } = painter("theater", w, d);
    theater(P, w, d, part);
    return { canvas: element, ax, ay };
  });
  return { back: parts[0], front: parts[1] };
}

function kloster(P: Painter, w: number, d: number) {
  const wall = {
    top: "#f1e9d8",
    left: "#e6dac2",
    right: "#bdae92",
    line: "#8f8168",
  };
  const roof = {
    lit: "#b0563f",
    dark: "#7c3a2a",
    gable: "#e6dac2",
    courses: "#5e2a1e",
  };
  P.poly(
    [
      [0, 0, 0],
      [w, 0, 0],
      [w, d, 0],
      [0, d, 0],
    ],
    "#d6ccb4",
  );
  P.poly(
    [
      [1.6, 1.6, 0],
      [w - 1.6, 1.6, 0],
      [w - 1.6, d - 2.4, 0],
      [1.6, d - 2.4, 0],
    ],
    "#7fae58",
  );
  P.shadow(0.2, 0.2, w - 0.2, d - 0.2, 2);
  const wing = (
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    axis: "u" | "v",
  ) => {
    P.box(u0, v0, u1, v1, 0, 30, wall);
    for (let u = u0 + 0.3; u < u1 - 0.2; u += 0.45)
      P.leftOpening(v1, u, u + 0.2, 8, 20, glass, "#8f8168");
    for (let v = v0 + 0.3; v < v1 - 0.2; v += 0.45)
      P.rightOpening(u1, v, v + 0.2, 8, 20, glass, "#8f8168");
    P.gable(u0, v0, u1, v1, 30, 22, axis, roof, 0.1);
  };
  // Back wing, side wings, then the church and the front.
  wing(0.3, 0.3, w - 0.3, 1.5, "u");
  wing(0.3, 1.5, 1.5, d - 2.2, "v");
  wing(w - 1.5, 1.5, w - 0.3, d - 2.2, "v");
  const cu = w / 2;
  P.box(cu - 1.0, 1.6, cu + 1.0, d - 2.0, 0, 40, wall);
  P.gable(cu - 1.0, 1.6, cu + 1.0, d - 2.0, 40, 26, "v", roof, 0.1);
  wing(0.3, d - 2.2, cu - 1.6, d - 0.6, "u");
  wing(cu + 1.6, d - 2.2, w - 0.3, d - 0.6, "u");
  // The church front with two towers and copper domes.
  P.box(cu - 1.6, d - 2.0, cu + 1.6, d - 0.5, 0, 52, wall);
  P.leftOpening(d - 0.5, cu - 0.25, cu + 0.25, 0, 22, "#4a2f1c");
  P.leftOpening(d - 0.5, cu - 0.5, cu + 0.5, 32, 44, "#e9d9b0", "#8f8168");
  const ctx = P.ctx;
  for (const u of [cu - 1.6, cu + 0.9]) {
    P.box(u, d - 1.3, u + 0.7, d - 0.5, 0, 92, wall);
    P.leftOpening(d - 0.5, u + 0.2, u + 0.5, 62, 76, "#e9d27a", "#8f8168");
    P.rightOpening(u + 0.7, d - 1.1, d - 0.8, 62, 76, glass, "#8f8168");
    const [x, y] = P.p(u + 0.35, d - 0.9, 92);
    const g = ctx.createRadialGradient(x - 5, y - 14, 2, x, y - 8, 16);
    g.addColorStop(0, "#9fd6bf");
    g.addColorStop(1, "#5fa58c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 2);
    ctx.bezierCurveTo(x - 13, y - 22, x + 13, y - 22, x + 13, y - 2);
    ctx.ellipse(x, y - 2, 13, 6, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#3f7a66";
    ctx.fillRect(x - 2, y - 27, 4, 10);
    ctx.beginPath();
    ctx.arc(x, y - 28, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function damm(P: Painter, w: number, d: number) {
  const concrete = {
    top: "#d2d0c6",
    left: "#aeaca2",
    right: "#8a887f",
    line: "#6d6b64",
  };
  P.box(0, 0.2, w, d - 0.2, 0, 26, concrete);
  for (let u = 0.5; u < w; u += 0.7)
    P.line([u, d - 0.2, 0], [u, d - 0.2, 26], "#8e8c84", 1);
  P.box(0, 0.2, w, 0.45, 26, 30, { ...concrete, top: "#e0ded4" });
  for (let u = 0.2; u < w; u += 0.5)
    P.box(u, 0.2, u + 0.06, 0.26, 30, 37, concrete);
  P.line([0, 0.23, 36], [w, 0.23, 36], "#6d6b64", 1);
}

const plankWood = {
  top: "#b98a52",
  left: "#8a5a32",
  right: "#6b4423",
  line: "#4a3320",
};

/** A wooden bridge along its axis, resting on piles and reaching onto both banks. */
function bruecke(P: Painter, w: number, d: number, axis: "x" | "y") {
  // Painted along u; along v the same with u and v swapped.
  const length = axis === "x" ? w : d;
  const at = (a: number, b: number, z: number): Point =>
    axis === "x" ? [a, b, z] : [b, a, z];
  const deck = (
    a0: number,
    b0: number,
    a1: number,
    b1: number,
    z0: number,
    z1: number,
  ) =>
    axis === "x"
      ? P.box(a0, b0, a1, b1, z0, z1, plankWood)
      : P.box(b0, a0, b1, a1, z0, z1, plankWood);
  const a0 = -0.3;
  const a1 = length + 0.3;
  P.poly(
    [
      at(a0, 0.25, 0),
      at(a1, 0.25, 0),
      at(a1 + 0.3, 0.9, 0),
      at(a0 + 0.3, 0.9, 0),
    ],
    "rgba(10, 25, 12, 0.25)",
  );
  for (let a = 0.5; a < length; a += 1) {
    deck(a - 0.06, 0.18, a + 0.06, 0.3, -4, 7);
    deck(a - 0.06, 0.7, a + 0.06, 0.82, -4, 7);
  }
  deck(a0, 0.15, a1, 0.85, 7, 10);
  for (let a = a0 + 0.2; a < a1; a += 0.18)
    P.line(at(a, 0.15, 10), at(a, 0.85, 10), "#8a5a32", 0.6);
  for (const b of [0.18, 0.82]) {
    for (let a = a0 + 0.1; a <= a1 - 0.05; a += 0.5)
      deck(a - 0.04, b - 0.04, a + 0.04, b + 0.04, 10, 20);
    P.line(at(a0 + 0.1, b, 20), at(a1 - 0.1, b, 20), "#5a3a22", 1.6);
    P.line(at(a0 + 0.1, b, 15), at(a1 - 0.1, b, 15), "#6b4423", 1);
  }
}

/** A port: a plank quay with a boathouse, bollards, a crane and some cargo. */
function hafen(P: Painter, w: number, d: number) {
  P.shadow(0.1, 0.1, w - 0.1, d - 0.1, 0.6);
  P.box(0.05, 0.05, w - 0.05, d - 0.05, 0, 5, plankWood);
  for (let u = 0.25; u < w; u += 0.22)
    P.line([u, 0.05, 5], [u, d - 0.05, 5], "#8a5a32", 0.6);
  // The boathouse at the back.
  P.box(0.25, 0.2, 1.55, 1.1, 5, 26, logs);
  P.leftOpening(1.1, 0.55, 1.15, 5, 20, "#3a2614");
  P.rightOpening(1.55, 0.4, 0.75, 13, 19, glass);
  P.gable(0.25, 0.2, 1.55, 1.1, 26, 18, "u", tiles, 0.15);
  // A small crane with a hanging net.
  P.box(w - 0.55, 0.3, w - 0.4, 0.45, 5, 52, logs);
  P.line([w - 0.47, 0.37, 50], [w - 0.47, 1.25, 50], "#5a3a22", 2);
  P.line([w - 0.47, 1.2, 50], [w - 0.47, 1.2, 34], "#3a2a1e", 0.8);
  P.box(w - 0.6, 1.1, w - 0.35, 1.3, 28, 34, {
    top: "#c9b27a",
    left: "#a8904f",
    right: "#86703a",
  });
  // Barrels and crates.
  P.box(1.8, 0.3, 2.1, 0.6, 5, 13, plankWood);
  P.box(1.85, 0.7, 2.15, 1.0, 5, 11, plankWood);
  const ctx = P.ctx;
  for (const [u, v] of [
    [0.5, 1.5],
    [0.85, 1.6],
  ]) {
    const [x, y] = P.p(u, v, 5);
    ctx.fillStyle = "#7a4a26";
    ctx.fillRect(x - 3.5, y - 10, 7, 10);
    ellipse(ctx, x, y - 10, 3.5, 1.6, "#9a6a3c");
    ctx.fillStyle = "#3a2614";
    ctx.fillRect(x - 3.5, y - 7, 7, 0.8);
    ctx.fillRect(x - 3.5, y - 3, 7, 0.8);
  }
  // Bollards along every edge, since the water may lie on any side.
  for (let u = 0.3; u < w; u += 1)
    for (const v of [0.1, d - 0.1])
      P.box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 5, 10, stone);
}

/** A wooden sailing boat along u, with a sail in the studio's colours. */
function schiff(P: Painter, w: number, d: number) {
  const v = d / 2;
  const bow = w - 0.05;
  const stern = 0.15;
  const half = 0.34;
  const ctx = P.ctx;
  const [wx, wy] = P.p(w / 2, v, 0);
  ellipse(ctx, wx + 3, wy + 2, 40, 12, "rgba(220, 240, 255, 0.25)");
  ellipse(ctx, wx + 2, wy + 1, 34, 9, "rgba(10, 30, 60, 0.25)");
  const deckZ = 9;
  // The hull: the far side, the near side and the deck.
  P.poly(
    [
      [stern, v - half, 0],
      [bow - 0.4, v - half, 0],
      [bow, v, 2],
      [bow, v, deckZ + 3],
      [bow - 0.4, v - half, deckZ],
      [stern, v - half, deckZ],
    ],
    "#6b4423",
    "#3a2614",
  );
  P.poly(
    [
      [stern, v + half, 0],
      [bow - 0.4, v + half, 0],
      [bow, v, 2],
      [bow, v, deckZ + 3],
      [bow - 0.4, v + half, deckZ],
      [stern, v + half, deckZ],
    ],
    "#8a5a32",
    "#3a2614",
  );
  P.poly(
    [
      [stern, v - half, 0],
      [stern, v + half, 0],
      [stern, v + half, deckZ],
      [stern, v - half, deckZ],
    ],
    "#5a3a22",
    "#3a2614",
  );
  P.poly(
    [
      [stern, v - half, deckZ],
      [bow - 0.4, v - half, deckZ],
      [bow, v, deckZ + 3],
      [bow - 0.4, v + half, deckZ],
      [stern, v + half, deckZ],
    ],
    "#c9a46c",
    "#6b4423",
  );
  for (let u = stern + 0.2; u < bow - 0.3; u += 0.2)
    P.line([u, v - half, deckZ], [u, v + half, deckZ], "#a8834e", 0.5);
  P.line([stern, v + half, 4], [bow - 0.4, v + half, 4], "#c23b2a", 1.2);
  // Mast, boom and sail.
  const mast = w * 0.45;
  P.line([mast, v, deckZ], [mast, v, 58], "#4a3320", 1.8);
  P.line([mast, v, 16], [stern + 0.1, v, 16], "#4a3320", 1.2);
  P.poly(
    [
      [mast, v, 56],
      [mast, v, 17],
      [stern + 0.12, v, 17],
    ],
    "#f2ead6",
    "#b9ae94",
  );
  P.poly(
    [
      [mast + 0.04, v, 52],
      [mast + 0.04, v, 18],
      [bow - 0.15, v, 14],
    ],
    "#e3d6b8",
    "#b9ae94",
  );
  const [fx, fy] = P.p(mast, v, 58);
  ctx.fillStyle = "#c23b2a";
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx + 9, fy + 2);
  ctx.lineTo(fx, fy + 4);
  ctx.fill();
}

// --- Living: farms, crafts, faith -------------------------------------------

/** A stone house with two floors of windows and a tiled roof. */
function steinhaus(P: Painter) {
  P.shadow(0.2, 0.2, 2.8, 2.8, 1.3);
  P.box(0.3, 0.3, 2.7, 2.7, 0, 40, stone);
  for (let z = 8; z < 40; z += 7) {
    P.line([0.3, 2.7, z], [2.7, 2.7, z], "#a89e88", 0.6);
    P.line([2.7, 0.3, z], [2.7, 2.7, z], "#857b67", 0.6);
  }
  P.leftOpening(2.7, 1.25, 1.75, 0, 16, "#4a2f1c");
  for (const u of [0.55, 2.05]) {
    P.leftOpening(2.7, u, u + 0.35, 8, 16, glow);
    P.leftOpening(2.7, u, u + 0.35, 24, 32, glass);
  }
  P.leftOpening(2.7, 1.3, 1.65, 24, 32, glow);
  for (const v of [0.6, 1.3, 2.0]) {
    P.rightOpening(2.7, v, v + 0.35, 8, 16, glass);
    P.rightOpening(2.7, v, v + 0.35, 24, 32, glass);
  }
  P.box(0.7, 0.6, 1.0, 0.9, 40, 74, { ...stone, top: "#4a443c" });
  P.gable(0.3, 0.3, 2.7, 2.7, 40, 26, "u", tiles, 0.18);
}

/** Rows of ripe grain on a field. */
function field(P: Painter, u0: number, v0: number, u1: number, v1: number) {
  P.poly(
    [
      [u0, v0, 0],
      [u1, v0, 0],
      [u1, v1, 0],
      [u0, v1, 0],
    ],
    "#b8913e",
  );
  for (let u = u0 + 0.15; u < u1; u += 0.28) {
    P.line([u, v0 + 0.1, 0], [u, v1 - 0.1, 0], "#7d6024", 1.6);
    P.line([u + 0.04, v0 + 0.1, 5], [u + 0.04, v1 - 0.1, 5], "#e3c45a", 2.2);
  }
}

function sheaf(P: Painter, u: number, v: number) {
  const ctx = P.ctx;
  const [x, y] = P.p(u, v, 0);
  ellipse(ctx, x + 2, y, 6, 2.5, "rgba(0, 0, 0, 0.25)");
  ctx.fillStyle = "#d9b34e";
  ctx.beginPath();
  ctx.moveTo(x - 5, y);
  ctx.lineTo(x - 2, y - 16);
  ctx.lineTo(x + 2, y - 16);
  ctx.lineTo(x + 5, y);
  ctx.fill();
  ctx.fillStyle = "#8a6a2c";
  ctx.fillRect(x - 3, y - 9, 6, 1.6);
}

/** A farm with a timbered house at the back and grain fields. */
function getreidehof(P: Painter, w: number, d: number) {
  field(P, 0.1, 1.9, w - 0.1, d - 0.1);
  field(P, 2.3, 0.1, w - 0.1, 1.8);
  P.shadow(0.2, 0.2, 2.0, 1.6, 0.9);
  P.box(0.2, 0.2, 2.0, 1.6, 0, 18, plaster);
  timber(P, 0.2, 0.2, 2.0, 1.6, 0, 18);
  P.leftOpening(1.6, 0.9, 1.3, 0, 12, "#4a2f1c");
  P.rightOpening(2.0, 0.6, 0.95, 7, 13, glass);
  P.gable(0.2, 0.2, 2.0, 1.6, 18, 18, "u", thatch, 0.16);
  sheaf(P, 2.6, 1.4);
  sheaf(P, 3.2, 1.5);
  sheaf(P, 3.8, 1.3);
}

function cow(P: Painter, u: number, v: number, spotted: boolean) {
  const ctx = P.ctx;
  const [x, y] = P.p(u, v, 0);
  ellipse(ctx, x + 2, y + 1, 10, 3, "rgba(0, 0, 0, 0.25)");
  ctx.fillStyle = "#3a2a20";
  for (const dx of [-6, -3, 3, 6]) ctx.fillRect(x + dx, y - 6, 1.6, 6);
  ellipse(ctx, x, y - 9, 9, 5, spotted ? "#f2ece0" : "#8a5a32");
  if (spotted) {
    ellipse(ctx, x - 3, y - 10, 3, 2, "#3a2a20");
    ellipse(ctx, x + 3, y - 8, 2.5, 1.8, "#3a2a20");
  }
  ellipse(ctx, x + 9, y - 11, 3.5, 3, spotted ? "#f2ece0" : "#7a4e26");
  ctx.fillStyle = "#e8b4a0";
  ctx.fillRect(x + 10, y - 10, 2.6, 2);
}

function pig(P: Painter, u: number, v: number) {
  const ctx = P.ctx;
  const [x, y] = P.p(u, v, 0);
  ellipse(ctx, x + 1, y + 1, 7, 2.5, "rgba(0, 0, 0, 0.25)");
  ctx.fillStyle = "#c98a86";
  for (const dx of [-4, 3]) ctx.fillRect(x + dx, y - 4, 1.6, 4);
  ellipse(ctx, x, y - 6, 6.5, 4, "#f0b3ac");
  ellipse(ctx, x + 6.5, y - 6.5, 2, 2, "#e89e98");
}

function chicken(P: Painter, u: number, v: number) {
  const ctx = P.ctx;
  const [x, y] = P.p(u, v, 0);
  ellipse(ctx, x, y - 3, 2.6, 2, "#fbf6e9");
  ellipse(ctx, x + 2, y - 5, 1.3, 1.3, "#fbf6e9");
  ctx.fillStyle = "#c23b2a";
  ctx.fillRect(x + 1.6, y - 6.8, 1.2, 1);
}

/** A farm with a barn, a fenced pasture, cows, pigs and chickens. */
function viehhof(P: Painter, w: number, d: number) {
  P.poly(
    [
      [0.1, 0.1, 0],
      [w - 0.1, 0.1, 0],
      [w - 0.1, d - 0.1, 0],
      [0.1, d - 0.1, 0],
    ],
    "#7fa84c",
  );
  P.poly(
    [
      [0.1, 0.1, 0],
      [2.4, 0.1, 0],
      [2.4, 1.9, 0],
      [0.1, 1.9, 0],
    ],
    "#9c8a62",
  );
  P.shadow(0.2, 0.2, 2.3, 1.7, 1.1);
  P.box(0.2, 0.2, 2.3, 1.7, 0, 22, logs);
  for (let z = 4; z < 22; z += 4) {
    P.line([0.2, 1.7, z], [2.3, 1.7, z], "#5a3c22", 0.8);
    P.line([2.3, 0.2, z], [2.3, 1.7, z], "#4a3018", 0.8);
  }
  P.leftOpening(1.7, 0.8, 1.6, 0, 16, "#3a2614");
  P.line([0.8, 1.7, 0], [1.6, 1.7, 16], "#8a5a32", 1);
  P.line([1.6, 1.7, 0], [0.8, 1.7, 16], "#8a5a32", 1);
  P.gable(0.2, 0.2, 2.3, 1.7, 22, 20, "u", tiles, 0.16);
  // A trough and the animals.
  P.box(2.8, 0.5, 3.8, 0.8, 0, 4, logs);
  const herd: [number, number, "cow" | "spot" | "pig" | "hen"][] = [
    [3.2, 1.4, "cow"],
    [4.2, 2.2, "spot"],
    [2.9, 2.7, "pig"],
    [3.6, 3.2, "pig"],
    [1.0, 2.6, "hen"],
    [1.4, 3.0, "hen"],
    [0.7, 3.2, "hen"],
    [1.8, 2.5, "hen"],
  ];
  herd.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [u, v, kind] of herd) {
    if (kind === "cow" || kind === "spot") cow(P, u, v, kind === "spot");
    else if (kind === "pig") pig(P, u, v);
    else chicken(P, u, v);
  }
  // Rails round the pasture.
  const rails = (a: [number, number], b: [number, number]) => {
    P.line([a[0], a[1], 7], [b[0], b[1], 7], "#7a5230", 1.2);
    P.line([a[0], a[1], 3.5], [b[0], b[1], 3.5], "#7a5230", 1.2);
  };
  rails([0.1, d - 0.1], [w - 0.1, d - 0.1]);
  rails([w - 0.1, 0.1], [w - 0.1, d - 0.1]);
  for (let u = 0.1; u <= w; u += 0.5)
    P.box(u - 0.04, d - 0.14, u + 0.04, d - 0.06, 0, 9, logs);
  for (let v = 0.1; v <= d; v += 0.5)
    P.box(w - 0.14, v - 0.04, w - 0.06, v + 0.04, 0, 9, logs);
}

/** A water mill: stone below, timber above, and a wheel on its side. */
function muehle(P: Painter) {
  P.shadow(0.3, 0.3, 2.5, 2.6, 1.2);
  P.box(0.3, 0.3, 2.4, 2.6, 0, 14, stone);
  P.box(0.3, 0.3, 2.4, 2.6, 14, 34, plaster);
  timber(P, 0.3, 0.3, 2.4, 2.6, 14, 34);
  P.leftOpening(2.6, 1.0, 1.45, 0, 13, "#4a2f1c");
  P.leftOpening(2.6, 0.5, 0.85, 20, 28, glow);
  P.gable(0.3, 0.3, 2.4, 2.6, 34, 24, "v", tiles, 0.16);
  // The wheel turns in the water beside the right face.
  const ctx = P.ctx;
  const [x, y] = P.p(2.75, 1.45, 15);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, -TH / TW, 0, 1, 0, 0);
  ctx.strokeStyle = "#5a3a22";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
    ctx.stroke();
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(Math.cos(a) * 17 - 2, Math.sin(a) * 17 - 2, 4, 4);
  }
  ctx.fillStyle = "#3a2614";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Sacks of flour by the door.
  for (const [u, v] of [
    [1.7, 2.8],
    [1.95, 2.85],
  ]) {
    const [sx, sy] = P.p(u, v, 0);
    ellipse(ctx, sx, sy - 5, 4, 5.5, "#efe8d8");
    ctx.fillStyle = "#b9ae94";
    ctx.fillRect(sx - 1.5, sy - 11, 3, 2);
  }
}

/** A timbered house with an oven at its side and loaves on a bench. */
function baeckerei(P: Painter) {
  P.shadow(0.2, 0.2, 2.6, 2.6, 1.2);
  P.box(0.3, 0.3, 2.3, 2.6, 0, 30, plaster);
  timber(P, 0.3, 0.3, 2.3, 2.6, 0, 30);
  P.leftOpening(2.6, 0.9, 1.35, 0, 18, "#4a2f1c");
  P.leftOpening(2.6, 1.6, 2.0, 10, 20, glow);
  P.rightOpening(2.3, 0.6, 0.95, 10, 20, glass);
  P.gable(0.3, 0.3, 2.3, 2.6, 30, 24, "u", tiles, 0.16);
  // The oven: a dome of stone with a glowing mouth.
  const ctx = P.ctx;
  const [x, y] = P.p(2.65, 1.55, 0);
  ellipse(ctx, x + 3, y + 1, 16, 6, "rgba(0, 0, 0, 0.25)");
  const g = ctx.createRadialGradient(x - 4, y - 14, 2, x, y - 8, 16);
  g.addColorStop(0, "#e0d6c2");
  g.addColorStop(1, "#9a8f7a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 14, 6, 0, Math.PI, 0);
  ctx.bezierCurveTo(x + 14, y - 22, x - 14, y - 22, x - 14, y - 2);
  ctx.fill();
  ellipse(ctx, x - 2, y - 6, 4, 3.5, "#f0a040");
  P.box(1.05, 0.8, 1.3, 1.05, 30, 62, { ...stone, top: "#4a443c" });
  // Loaves on a bench.
  P.box(0.45, 2.75, 1.4, 2.95, 0, 7, plankWood);
  for (const u of [0.6, 0.85, 1.1]) {
    const [bx, by] = P.p(u, 2.85, 7);
    ellipse(ctx, bx, by - 2, 4, 2.6, "#c47a3a");
    ellipse(ctx, bx - 1, by - 3, 2, 1, "#e0a060");
  }
}

function barrel(P: Painter, u: number, v: number, z = 0) {
  const ctx = P.ctx;
  const [x, y] = P.p(u, v, z);
  ctx.fillStyle = "#7a4a26";
  ctx.fillRect(x - 4, y - 11, 8, 11);
  ellipse(ctx, x, y - 11, 4, 1.8, "#9a6a3c");
  ctx.fillStyle = "#3a2614";
  ctx.fillRect(x - 4, y - 8, 8, 0.9);
  ctx.fillRect(x - 4, y - 3, 8, 0.9);
}

/** A brewery: a stone house with a tall vent and barrels outside. */
function brauerei(P: Painter) {
  P.shadow(0.2, 0.2, 2.7, 2.6, 1.3);
  P.box(0.3, 0.3, 2.4, 2.4, 0, 32, stone);
  P.leftOpening(2.4, 0.9, 1.5, 0, 20, "#4a2f1c");
  for (const v of [0.6, 1.4]) P.rightOpening(2.4, v, v + 0.4, 12, 24, glow);
  P.gable(0.3, 0.3, 2.4, 2.4, 32, 22, "v", slate, 0.16);
  // The vent of the brew house on the ridge.
  P.box(1.15, 1.15, 1.6, 1.6, 44, 62, plaster);
  P.pyramid(1.15, 1.15, 1.6, 1.6, 62, 10, slate);
  for (const [u, v] of [
    [2.6, 0.6],
    [2.65, 1.0],
    [2.6, 1.4],
  ])
    barrel(P, u, v);
  barrel(P, 2.62, 0.8, 11);
  barrel(P, 0.7, 2.7);
}

/**
 * A church without religious symbols: a nave with tall windows and a tower
 * with a pointed slate spire, high enough to stand out of the Sihlsee.
 */
function kirche(P: Painter, w: number, d: number) {
  const wall = {
    top: "#ece3cf",
    left: "#e2d6bc",
    right: "#b9aa8c",
    line: "#8f8168",
  };
  P.shadow(0.4, 0.3, w - 0.4, d - 0.2, 2);
  // The tower at the back, the nave in front of it.
  P.box(1.3, 0.3, 2.7, 1.7, 0, 96, wall);
  for (const z of [64, 80]) {
    P.leftOpening(1.7, 1.75, 2.25, z, z + 10, "#3a2a1e", "#8f8168");
    P.rightOpening(2.7, 0.75, 1.25, z, z + 10, "#3a2a1e", "#8f8168");
  }
  P.pyramid(1.3, 0.3, 2.7, 1.7, 96, 54, slate, 0.08);
  P.box(0.6, 1.7, 3.4, d - 0.3, 0, 36, wall);
  for (let v = 2.1; v < d - 0.6; v += 0.75)
    leftArchRight(P, 3.4, v, v + 0.3, 8, 28, glass);
  leftArch(P, d - 0.3, 1.65, 2.35, 0, 22, "#4a2f1c");
  leftArch(P, d - 0.3, 1.8, 2.2, 26, 34, glass);
  P.gable(0.6, 1.7, 3.4, d - 0.3, 36, 28, "v", tiles, 0.12);
}

/** An arched window on the right face (u = u) between v0..v1 and z0..z1. */
function leftArchRight(
  P: Painter,
  u: number,
  v0: number,
  v1: number,
  z0: number,
  z1: number,
  fill: string,
) {
  const ctx = P.ctx;
  const vm = (v0 + v1) / 2;
  const r = ((v1 - v0) * TW) / 4;
  ctx.beginPath();
  ctx.moveTo(...P.p(u, v0, z0));
  ctx.lineTo(...P.p(u, v0, z1 - r));
  const [mx, my] = P.p(u, vm, z1 - r);
  ctx.ellipse(mx, my, r * 1.12, r, -Math.atan2(TH, TW), Math.PI, 0);
  ctx.lineTo(...P.p(u, v1, z0));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#6f6656";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A plain rounded tombstone at (u, v), seen from the isometric angle. */
function tombstone(ctx: Ctx, x: number, y: number, scale = 1) {
  ellipse(ctx, x + 3 * scale, y, 6 * scale, 2.4 * scale, "rgba(0,0,0,0.3)");
  ctx.fillStyle = "#9a958a";
  ctx.beginPath();
  ctx.moveTo(x - 4 * scale, y);
  ctx.lineTo(x - 4 * scale, y - 9 * scale);
  ctx.arc(x, y - 9 * scale, 4 * scale, Math.PI, 0);
  ctx.lineTo(x + 4 * scale, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c2bdb0";
  ctx.beginPath();
  ctx.moveTo(x - 4 * scale, y);
  ctx.lineTo(x - 4 * scale, y - 9 * scale);
  ctx.arc(x, y - 9 * scale, 4 * scale, Math.PI, Math.PI * 1.5);
  ctx.lineTo(x - 1.5 * scale, y);
  ctx.closePath();
  ctx.fill();
}

/** A graveyard: a low wall, grass, a yew, and its tombstones. */
function friedhof(P: Painter, w: number, d: number, graves: number) {
  P.poly(
    [
      [0.1, 0.1, 0],
      [w - 0.1, 0.1, 0],
      [w - 0.1, d - 0.1, 0],
      [0.1, d - 0.1, 0],
    ],
    "#6f9a48",
  );
  const low = { ...stone, top: "#ddd6c4" };
  P.box(0.1, 0.1, w - 0.1, 0.25, 0, 6, low);
  P.box(0.1, 0.1, 0.25, d - 0.1, 0, 6, low);
  // A yew in the back corner.
  const ctx = P.ctx;
  const [tx, ty] = P.p(0.6, 0.6, 0);
  ellipse(ctx, tx + 4, ty + 1, 10, 4, "rgba(0, 0, 0, 0.3)");
  ctx.fillStyle = "#4a3320";
  ctx.fillRect(tx - 1.5, ty - 10, 3, 10);
  ellipse(ctx, tx, ty - 20, 9, 13, "#24502c");
  ellipse(ctx, tx - 2, ty - 24, 5, 7, "#326a3a");
  const spots: [number, number][] = [];
  for (let v = 0.75; v < d - 0.3; v += 0.65)
    for (let u = 0.75; u < w - 0.3; u += 0.55) {
      if (u < 1.1 && v < 1.1) continue;
      spots.push([u, v]);
    }
  spots
    .slice(0, graves)
    .sort((a, b) => a[0] + a[1] - b[0] - b[1])
    .forEach(([u, v]) => tombstone(ctx, ...P.p(u, v, 0)));
  P.box(0.1, d - 0.25, w - 0.1, d - 0.1, 0, 6, low);
  P.box(w - 0.25, 0.1, w - 0.1, d - 0.1, 0, 6, low);
}

/** The ISE AG's forge: an open smithy with anvil, hearth and its name. */
function ise(P: Painter) {
  const c = iseColours;
  P.shadow(0.2, 0.2, 2.8, 2.8, 1.3);
  P.box(0.3, 0.3, 2.7, 1.3, 0, 30, stone);
  P.box(0.3, 1.3, 1.1, 2.7, 0, 30, stone);
  // The open workshop under a roof on posts.
  P.poly(
    [
      [1.1, 1.3, 0],
      [2.7, 1.3, 0],
      [2.7, 2.7, 0],
      [1.1, 2.7, 0],
    ],
    "#5f5548",
  );
  P.box(1.5, 1.5, 2.0, 2.0, 0, 9, { ...stone, top: "#3a3028" });
  const ctx = P.ctx;
  const [hx, hy] = P.p(1.75, 1.75, 9);
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12);
  g.addColorStop(0, "rgba(255, 220, 120, 1)");
  g.addColorStop(0.5, "rgba(240, 120, 40, 0.8)");
  g.addColorStop(1, "rgba(200, 60, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(hx, hy, 12, 0, Math.PI * 2);
  ctx.fill();
  // The anvil.
  P.box(2.15, 2.1, 2.35, 2.25, 0, 6, {
    top: "#3a3f46",
    left: "#2a2e33",
    right: "#1e2125",
  });
  P.box(2.05, 2.08, 2.45, 2.28, 6, 9, {
    top: "#5a616a",
    left: "#3a3f46",
    right: "#2a2e33",
  });
  for (const [u, v] of [
    [2.65, 2.65],
    [2.65, 1.35],
    [1.15, 2.65],
  ])
    P.box(u - 0.06, v - 0.06, u + 0.04, v + 0.04, 0, 30, logs);
  P.box(0.3, 0.3, 2.7, 2.7, 30, 33, plankWood);
  P.gable(0.3, 0.3, 2.7, 2.7, 33, 20, "u", slate, 0.16);
  P.box(0.6, 0.6, 1.0, 1.0, 33, 70, { ...stone, top: "#2a2420" });
  // The name on the beam over the open workshop.
  P.box(1.1, 2.62, 2.7, 2.72, 24, 33, plankWood);
  frontSign(P, 2.73, 1.2, 2.6, 24.5, 32.5, [{ text: "ISE AG", size: 9 }], {
    board: c.board,
    edge: "#2a2420",
    ink: c.ink,
  });
  P.pennant(2.8, 2.8, 0, 58, [c.board, c.accent]);
}

/** The Brot auswerfen: a wooden stage with garlands and baskets of bread. */
function brot(P: Painter, w: number, d: number) {
  P.shadow(0.1, 0.1, w - 0.1, d - 0.1, 0.6);
  P.box(0.2, 0.2, w - 0.2, d - 0.2, 0, 12, plankWood);
  for (let u = 0.4; u < w - 0.2; u += 0.3)
    P.line([u, 0.2, 12], [u, d - 0.2, 12], "#8a5a32", 0.6);
  // Steps at the front.
  P.box(1.2, d - 0.2, 1.8, d + 0.05, 0, 6, plankWood);
  const posts: [number, number][] = [
    [0.3, 0.3],
    [w - 0.3, 0.3],
    [0.3, d - 0.3],
    [w - 0.3, d - 0.3],
  ];
  for (const [u, v] of posts.slice(0, 2))
    P.box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 12, 50, logs);
  // A garland between the back posts, with pennants.
  const colours = ["#c23b2a", "#f4d24a", "#2a62b8", "#f2f2f2"];
  for (let k = 0; k < 8; k++) {
    const u0 = 0.3 + ((w - 0.6) * k) / 8;
    const u1 = 0.3 + ((w - 0.6) * (k + 1)) / 8;
    const sag = (t: number) => 46 - Math.sin(t * Math.PI) * 8;
    P.poly(
      [
        [u0, 0.3, sag(k / 8)],
        [u1, 0.3, sag((k + 1) / 8)],
        [(u0 + u1) / 2, 0.3, sag((k + 0.5) / 8) - 7],
      ],
      colours[k % colours.length],
    );
  }
  // Baskets of bread.
  const ctx = P.ctx;
  for (const [u, v] of [
    [0.8, 0.8],
    [1.6, 0.9],
    [2.3, 0.8],
  ]) {
    const [x, y] = P.p(u, v, 12);
    ctx.fillStyle = "#8a5a32";
    ctx.beginPath();
    ctx.ellipse(x, y - 3, 7, 3, 0, 0, Math.PI);
    ctx.lineTo(x - 7, y - 3);
    ctx.fill();
    for (const dx of [-3, 0, 3])
      ellipse(ctx, x + dx, y - 5, 2.6, 1.8, "#c47a3a");
  }
  for (const [u, v] of posts.slice(2))
    P.box(u - 0.05, v - 0.05, u + 0.05, v + 0.05, 12, 50, logs);
}

/** A tombstone outside a graveyard. */
export function tombPicture(): Picture {
  const { element, ctx } = canvas(24, 28);
  tombstone(ctx, 12, 24, 1.2);
  return { canvas: element, ax: 12, ay: 24 };
}

/** The fire in the first clearing: a ring of stones, logs and flames. */
export function firePicture(): Picture {
  const { element, ctx } = canvas(48, 48);
  const x = 24;
  const y = 38;
  ellipse(ctx, x + 2, y + 1, 16, 6, "rgba(0, 0, 0, 0.3)");
  ellipse(ctx, x, y - 1, 13, 5.5, "#3a2a1e");
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    ellipse(
      ctx,
      x + Math.cos(a) * 13,
      y - 1 + Math.sin(a) * 5.5,
      3,
      2.2,
      "#9a958a",
    );
  }
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x + 6, y - 6);
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x - 6, y - 6);
  ctx.stroke();
  const g = ctx.createRadialGradient(x, y - 10, 1, x, y - 8, 14);
  g.addColorStop(0, "rgba(255, 245, 190, 1)");
  g.addColorStop(0.4, "rgba(255, 170, 60, 0.9)");
  g.addColorStop(1, "rgba(220, 80, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 3);
  ctx.quadraticCurveTo(x - 6, y - 16, x, y - 26);
  ctx.quadraticCurveTo(x + 6, y - 16, x + 7, y - 3);
  ctx.fill();
  return { canvas: element, ax: x, ay: y };
}

/** A building's picture for its footprint, anchored at the footprint's top corner. */
export function buildingPicture(
  kind: Kind,
  w: number,
  d: number,
  game?: string,
  /** The axis a bridge spans along. */
  axis: "x" | "y" = "x",
  /** The game's title, written on its houses. */
  title = "",
  /** Graves in a graveyard. */
  graves = 0,
): Picture {
  const { element, P, ax, ay } = painter(kind, w, d);
  switch (kind) {
    case "huette":
      hut(P);
      break;
    case "spielhaus":
      // The house stands at the back, its name on its front.
      if (game === "moto-devil") motoHouse(P, title);
      else if (game === "car-drive") carHouse(P, title);
      else
        spielhaus(
          new Painter(
            P.ctx,
            P.ox + ((w - 3) / 2) * (TW / 2),
            P.oy + ((w - 3) / 2) * (TH / 2),
          ),
          title,
          game,
        );
      break;
    case "bibliothek":
      bibliothek(P, title, game);
      break;
    case "druckerei":
      druckerei(P);
      break;
    case "schafweide":
      schafweide(P, w, d);
      break;
    case "klause":
      klause(P);
      break;
    case "steinbruch":
      steinbruch(P, w, d);
      break;
    case "theater":
      theater(P, w, d);
      break;
    case "kloster":
      kloster(P, w, d);
      break;
    case "damm":
      damm(P, w, d);
      break;
    case "bruecke":
      bruecke(P, w, d, axis);
      break;
    case "hafen":
      hafen(P, w, d);
      break;
    case "schiff":
      schiff(P, w, d);
      break;
    case "steinhaus":
      steinhaus(P);
      break;
    case "getreidehof":
      getreidehof(P, w, d);
      break;
    case "viehhof":
      viehhof(P, w, d);
      break;
    case "muehle":
      muehle(P);
      break;
    case "baeckerei":
      baeckerei(P);
      break;
    case "brauerei":
      brauerei(P);
      break;
    case "kirche":
      kirche(P, w, d);
      break;
    case "friedhof":
      friedhof(P, w, d, graves);
      break;
    case "ise":
      ise(P);
      break;
    case "brot":
      brot(P, w, d);
      break;
  }
  return { canvas: element, ax, ay };
}

// --- Ground textures --------------------------------------------------------

/** A seamless 256 × 256 texture for the ground: meadow, forest floor or bank. */
export function groundTexture(
  kind: "meadow" | "floor" | "bank" | "cobble",
): HTMLCanvasElement {
  if (kind === "cobble") return cobbles(256, 16, 4);
  const size = 256;
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const ctx = element.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context");
  const base = { meadow: "#6f9e45", floor: "#2f4a2a", bank: "#9c8a62" }[kind];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rnd = random({ meadow: 1, floor: 2, bank: 3 }[kind]);
  // Soft patches, drawn over the edges too, so the tile repeats.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 10 + rnd() * 30;
    const tint = rnd() < 0.5 ? "255, 255, 200" : "10, 30, 10";
    const alpha = kind === "floor" ? 0.08 : 0.12;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(
          x + dx,
          y + dy,
          0,
          x + dx,
          y + dy,
          r,
        );
        g.addColorStop(0, `rgba(${tint}, ${alpha})`);
        g.addColorStop(1, `rgba(${tint}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  const strokes = kind === "meadow" ? 2600 : kind === "floor" ? 1600 : 900;
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * (size - 8) + 4;
    const y = rnd() * (size - 8) + 4;
    if (kind === "meadow") {
      ctx.strokeStyle =
        rnd() < 0.5 ? "rgba(190, 230, 120, 0.35)" : "rgba(40, 80, 25, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 3);
      ctx.stroke();
    } else if (kind === "floor") {
      ctx.strokeStyle =
        rnd() < 0.6 ? "rgba(110, 80, 45, 0.35)" : "rgba(20, 40, 18, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 3);
      ctx.stroke();
    } else {
      ctx.fillStyle =
        rnd() < 0.5 ? "rgba(255, 245, 210, 0.3)" : "rgba(70, 55, 35, 0.3)";
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  return element;
}

/**
 * Cobblestones in rows, seamless: `size` pixels square, stones `stone`
 * pixels across, with a seed for their shades. Light and calm, with narrow
 * joints. `faint` ones, under texts, have stones and mortar of almost the
 * same colour, so only a hint of their pattern competes with the letters.
 */
export function cobbles(
  size: number,
  stone: number,
  seed: number,
  faint = false,
) {
  const element = document.createElement("canvas");
  element.width = element.height = size;
  const ctx = element.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context");
  ctx.fillStyle = faint ? "#d3cbb7" : "#b8af9b";
  ctx.fillRect(0, 0, size, size);
  const rnd = random(seed);
  const rows = Math.round(size / stone);
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? stone / 2 : 0;
    for (let c = -1; c <= rows; c++) {
      const x = c * stone + shift;
      const y = r * stone;
      const light = faint
        ? 216 + Math.floor(rnd() * 5)
        : 208 + Math.floor(rnd() * 18);
      const tint = Math.floor(rnd() * (faint ? 3 : 8));
      ctx.fillStyle = `rgb(${light + tint}, ${light + 2}, ${light - 12 - tint})`;
      ctx.beginPath();
      ctx.roundRect(x + 0.7, y + 0.7, stone - 1.4, stone - 1.4, stone * 0.3);
      ctx.fill();
    }
  }
  return element;
}

/**
 * The ground under a found text: a dark green forest floor, and cobbles on
 * the paved tiles. `res` pixels per tile.
 */
export function textFloor(
  w: number,
  h: number,
  res: number,
  paved: (u: number, v: number) => boolean,
): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = w * res;
  element.height = h * res;
  const ctx = element.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context");
  ctx.fillStyle = "#284526";
  ctx.fillRect(0, 0, element.width, element.height);
  const rnd = random(w * 131 + h);
  for (let i = 0; i < w * h * 40; i++) {
    ctx.fillStyle =
      rnd() < 0.5 ? "rgba(120, 160, 80, 0.18)" : "rgba(10, 25, 10, 0.25)";
    ctx.fillRect(rnd() * element.width, rnd() * element.height, 2, 1.4);
  }
  const stones = cobbles(res, res / 4, 4, true);
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++)
      if (paved(u, v)) ctx.drawImage(stones, u * res, v * res);
  return element;
}

/** Ground brightness from gentle hills, so the forest does not look flat. */
export function hill(tx: number, ty: number): number {
  const n = hash(Math.floor(tx / 3), Math.floor(ty / 3), 90) * 0.04;
  const a = Math.sin(tx * 0.13 + Math.sin(ty * 0.07) * 2) * 0.5;
  const b = Math.sin(ty * 0.11 + Math.cos(tx * 0.05) * 2) * 0.5;
  return 0.9 + (a + b) * 0.08 + n;
}
