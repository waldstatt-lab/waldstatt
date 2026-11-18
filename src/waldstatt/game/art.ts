/**
 * The game's art, painted for the Waldstatt on canvases at twice the world
 * resolution: shaded trees, Waldleute, buildings seen from the isometric
 * angle, and the ground textures. The light comes from the upper left. The
 * look borrows the genre's isometric view, not any game's pictures: nothing is
 * traced or copied.
 */
import { STAGE, type Kind } from "./config";
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
  const ctx = element.getContext("2d");
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

// --- Waldleute --------------------------------------------------------------

export const workerFrame = { w: 30, h: 44, ax: 15, ay: 41 };

/** A Waldmensch facing right: stand, two walking frames, two chopping frames. */
export function workerAtlas(): HTMLCanvasElement {
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
    // Tunic with a belt.
    const tunic = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
    tunic.addColorStop(0, "#c55a3a");
    tunic.addColorStop(1, "#7d2f1e");
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.moveTo(x - 5.5, y - 25);
    ctx.lineTo(x + 5.5, y - 25);
    ctx.lineTo(x + 6.5, y - 11);
    ctx.lineTo(x - 6.5, y - 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#4a3320";
    ctx.fillRect(x - 6, y - 16, 12, 2);
    // Head and hat.
    const head = ctx.createRadialGradient(x - 1.5, y - 30, 1, x, y - 29, 5);
    head.addColorStop(0, "#f2cfa6");
    head.addColorStop(1, "#c08860");
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, y - 29, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2f5a32";
    ctx.beginPath();
    ctx.ellipse(x, y - 32.5, 6.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3d7341";
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 33);
    ctx.quadraticCurveTo(x, y - 41, x + 4, y - 33);
    ctx.fill();
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
class Painter {
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
  ortstafel: 40,
  chronik: 30,
  spielidee: 30,
  anleitung: 40,
  spielhaus: 110,
  theater: 130,
  kloster: 190,
  damm: 50,
  bruecke: 34,
  hafen: 80,
  schiff: 70,
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

function spielhaus(P: Painter, game?: string) {
  const [flag, sign] = gameColours[game ?? ""] ?? ["#b0782e", "#f0e0b0"];
  P.shadow(0.2, 0.2, 2.8, 2.8, 1.3);
  P.box(0.3, 0.3, 2.7, 2.7, 0, 3, stone);
  P.box(0.35, 0.35, 2.65, 2.65, 3, 36, plaster);
  timber(P, 0.35, 0.35, 2.65, 2.65, 3, 36);
  P.leftOpening(2.65, 1.25, 1.75, 3, 22, "#4a2f1c");
  for (const u of [0.6, 2.05]) P.leftOpening(2.65, u, u + 0.4, 14, 26, glow);
  for (const v of [0.6, 1.4, 2.05])
    P.rightOpening(2.65, v, v + 0.35, 14, 26, glass);
  // The game's sign over the door.
  P.leftOpening(2.65, 1.0, 2.0, 27, 33, flag, "#3a2614");
  P.leftOpening(2.65, 1.15, 1.85, 28.5, 31.5, sign, flag);
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

/** A low wooden frame round a board lying on the ground; its text is HTML. */
function board(P: Painter, w: number, d: number, roof: boolean) {
  P.shadow(0.05, 0.05, w - 0.05, d - 0.05, 0.25);
  const frame = {
    top: "#a87a4c",
    left: "#8a5a32",
    right: "#6b4423",
    line: "#4a3320",
  };
  P.box(0, 0, w, 0.15, 0, 4, frame);
  P.box(0, 0.15, 0.15, d - 0.15, 0, 4, frame);
  P.box(w - 0.15, 0.15, w, d - 0.15, 0, 4, frame);
  P.box(0, d - 0.15, w, d, 0, 4, frame);
  if (!roof) return;
  // Two posts and a small roof at the back, like a notice board.
  P.box(0.2, 0.05, 0.35, 0.2, 0, 30, logs);
  P.box(w - 0.35, 0.05, w - 0.2, 0.2, 0, 30, logs);
  P.gable(0.05, -0.1, w - 0.05, 0.3, 30, 8, "u", tiles, 0.05);
}

function anleitung(P: Painter, w: number, d: number) {
  board(P, w, d, true);
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

const plank = {
  top: "#b98a52",
  left: "#8a5a32",
  right: "#6b4423",
  line: "#4a3320",
};

/**
 * A wooden amphitheatre: tiered stands all round the stage. The stage itself
 * is left empty: its picture lies on the ground below (stage.ts), so the
 * stands in front of it hide its edge.
 */
function theater(P: Painter, w: number, d: number) {
  const S = STAGE;
  const earth = "#b49a6a";
  for (const [u0, v0, u1, v1] of [
    [0, 0, w, S.v0],
    [0, S.v0, S.u0, S.v1],
    [S.u1, S.v0, w, S.v1],
    [0, S.v1, w, d],
  ])
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
  for (let i = 0; i < 220; i++) {
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
  const outer = bands.length - 1;
  // Back to front: the back and left stands from the outside in, then the
  // stage, then the right and front stands from the inside out.
  for (const band of [...bands].reverse()) {
    tier(band.back, band.height, "u");
    if (band.r === outer) railing(band.back, band.height, "back");
  }
  for (const band of [...bands].reverse()) {
    tier(band.left, band.height, "v");
    if (band.r === outer) railing(band.left, band.height, "left");
  }
  for (const band of bands) {
    tier(band.right, band.height, "v");
    if (band.r === outer) railing(band.right, band.height, "right");
  }
  for (const band of bands) {
    tier(band.front, band.height, "u");
    if (band.r === outer) railing(band.front, band.height, "front");
  }
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

/** A scroll's two rollers; the parchment between them is HTML. */
function scroll(P: Painter, w: number, d: number) {
  P.shadow(0.2, 0.2, w - 0.2, d - 0.2, 0.3);
  for (const v of [0.25, d - 0.25]) {
    P.box(0.3, v - 0.22, w - 0.3, v + 0.22, 0, 9, {
      top: "#f5e9c8",
      left: "#e2cc98",
      right: "#c4a97a",
      line: "#9a7f52",
    });
    P.box(0, v - 0.18, 0.3, v + 0.18, 0, 8, logs);
    P.box(w - 0.3, v - 0.18, w, v + 0.18, 0, 8, logs);
  }
  P.box(w / 2 - 0.15, d - 0.5, w / 2 + 0.15, d - 0.05, 9, 11, {
    top: "#b8323a",
    left: "#a02a32",
    right: "#7c1f26",
  });
}

/** A building's picture for its footprint, anchored at the footprint's top corner. */
export function buildingPicture(
  kind: Kind,
  w: number,
  d: number,
  game?: string,
  /** The axis a bridge spans along. */
  axis: "x" | "y" = "x",
): Picture {
  const { element, P, ax, ay } = painter(kind, w, d);
  switch (kind) {
    case "huette":
      hut(P);
      break;
    case "spielhaus":
      // The house stands centred at the back; its plate lies in front.
      spielhaus(
        new Painter(
          P.ctx,
          P.ox + ((w - 3) / 2) * (TW / 2),
          P.oy + ((w - 3) / 2) * (TH / 2),
        ),
        game,
      );
      break;
    case "druckerei":
      druckerei(P);
      break;
    case "schafweide":
      schafweide(P, w, d);
      break;
    case "ortstafel":
      board(P, w, d, false);
      break;
    case "anleitung":
      anleitung(P, w, d);
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
    case "chronik":
    case "spielidee":
      scroll(P, w, d);
      break;
  }
  return { canvas: element, ax, ay };
}

// --- Ground textures --------------------------------------------------------

/** A seamless 256 × 256 texture for the ground: meadow, forest floor or bank. */
export function groundTexture(
  kind: "meadow" | "floor" | "bank",
): HTMLCanvasElement {
  const size = 256;
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const ctx = element.getContext("2d");
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

/** Ground brightness from gentle hills, so the forest does not look flat. */
export function hill(tx: number, ty: number): number {
  const n = hash(Math.floor(tx / 3), Math.floor(ty / 3), 90) * 0.04;
  const a = Math.sin(tx * 0.13 + Math.sin(ty * 0.07) * 2) * 0.5;
  const b = Math.sin(ty * 0.11 + Math.cos(tx * 0.05) * 2) * 0.5;
  return 0.9 + (a + b) * 0.08 + n;
}
