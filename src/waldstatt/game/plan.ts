/**
 * The top-down art for the plan view (iso.ts): buildings, trees and
 * Waldleute seen from straight above, painted in tile units at 64 pixels per
 * tile. The light comes from the upper left, as in the isometric art; shadows
 * fall to the lower right.
 */
import { STAGE, type Kind } from "./config";
import { standBands } from "./art";

/** Canvas pixels per tile. */
export const PLAN_RES = 64;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = Math.ceil(w * PLAN_RES);
  element.height = Math.ceil(h * PLAN_RES);
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.scale(PLAN_RES, PLAN_RES);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { element, ctx };
}

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

function rect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  line?: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.03;
    ctx.strokeRect(x, y, w, h);
  }
}

function shadow(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  reach = 0.25,
) {
  ctx.fillStyle = "rgba(10, 25, 12, 0.3)";
  ctx.fillRect(x + reach, y + reach, w, h);
}

/** A gabled roof from above: two slopes, the lit one upper or left. */
function roof(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  along: "x" | "y",
  lit: string,
  dark: string,
  course: string,
) {
  shadow(ctx, x, y, w, h);
  if (along === "x") {
    rect(ctx, x, y, w, h / 2, lit);
    rect(ctx, x, y + h / 2, w, h / 2, dark);
    ctx.strokeStyle = course;
    ctx.lineWidth = 0.025;
    for (let k = 1; k < 6; k++) {
      const t = (k / 6) * h;
      ctx.beginPath();
      ctx.moveTo(x, y + t);
      ctx.lineTo(x + w, y + t);
      ctx.stroke();
    }
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
  } else {
    rect(ctx, x, y, w / 2, h, lit);
    rect(ctx, x + w / 2, y, w / 2, h, dark);
    ctx.strokeStyle = course;
    ctx.lineWidth = 0.025;
    for (let k = 1; k < 6; k++) {
      const t = (k / 6) * w;
      ctx.beginPath();
      ctx.moveTo(x + t, y);
      ctx.lineTo(x + t, y + h);
      ctx.stroke();
    }
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();
  }
  ctx.strokeStyle = course;
  ctx.lineWidth = 0.04;
  ctx.strokeRect(x, y, w, h);
}

const thatch = ["#d9b45e", "#a8833a", "#86662c"] as const;
const tiles = ["#c25a3c", "#8f3a26", "#6e2a1b"] as const;
const slate = ["#7c8796", "#4f5967", "#3a424d"] as const;
const copper = ["#8ccbb0", "#5fa58c", "#3f7a66"] as const;

const gameColours: Record<string, [string, string]> = {
  "moto-devil": ["#c23b2a", "#f4d24a"],
  "car-drive": ["#2a62b8", "#f2f2f2"],
};

function frame(ctx: Ctx, w: number, h: number) {
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 0.15;
  ctx.strokeRect(0.075, 0.075, w - 0.15, h - 0.15);
}

function sheep(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 0.06, y + 0.06, 0.2, 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - 0.06, y - 0.05, 0.02, x, y, 0.2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#cfc8b8");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, 0.19, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3330";
  ctx.beginPath();
  ctx.arc(x + 0.2, y, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function theatre(ctx: Ctx, w: number, h: number) {
  const S = STAGE;
  rect(ctx, 0, 0, w, h, "#b49a6a");
  for (const band of standBands(w, h)) {
    // Higher rows are lighter: they catch more light.
    const shade = ["#8a5a32", "#a0703f", "#b98a52"][band.r] ?? "#b98a52";
    for (const part of [band.back, band.left, band.right, band.front]) {
      shadow(ctx, part.u0, part.v0, part.u1 - part.u0, part.v1 - part.v0, 0.08);
      rect(
        ctx,
        part.u0,
        part.v0,
        part.u1 - part.u0,
        part.v1 - part.v0,
        shade,
        "#4a3320",
      );
    }
    ctx.strokeStyle = "rgba(74, 51, 32, 0.6)";
    ctx.lineWidth = 0.02;
    for (const part of [band.left, band.right]) {
      for (const f of [1 / 3, 2 / 3]) {
        const u = part.u0 + (part.u1 - part.u0) * f;
        ctx.beginPath();
        ctx.moveTo(u, part.v0);
        ctx.lineTo(u, part.v1);
        ctx.stroke();
      }
    }
    for (const part of [band.back, band.front]) {
      for (const f of [1 / 3, 2 / 3]) {
        const v = part.v0 + (part.v1 - part.v0) * f;
        ctx.beginPath();
        ctx.moveTo(part.u0, v);
        ctx.lineTo(part.u1, v);
        ctx.stroke();
      }
    }
  }
  // The stage's planks.
  rect(ctx, S.u0, S.v0, S.u1 - S.u0, S.v1 - S.v0, "#a8743f", "#4a3320");
}

function kloster(ctx: Ctx, w: number, h: number) {
  rect(ctx, 0, 0, w, h, "#d6ccb4");
  rect(ctx, 1.6, 1.6, w - 3.2, h - 4, "#7fae58");
  const wing = (
    x: number,
    y: number,
    ww: number,
    hh: number,
    along: "x" | "y",
  ) => roof(ctx, x, y, ww, hh, along, "#b0563f", "#7c3a2a", "#5e2a1e");
  wing(0.3, 0.3, w - 0.6, 1.2, "x");
  wing(0.3, 1.5, 1.2, h - 3.7, "y");
  wing(w - 1.5, 1.5, 1.2, h - 3.7, "y");
  const cu = w / 2;
  wing(cu - 1, 1.6, 2, h - 3.6, "y");
  wing(0.3, h - 2.2, cu - 1.9, 1.6, "x");
  wing(cu + 1.6, h - 2.2, w - cu - 1.9, 1.6, "x");
  rect(ctx, cu - 1.6, h - 2, 3.2, 1.5, "#e6dac2", "#8f8168");
  for (const u of [cu - 1.25, cu + 1.25]) {
    const g = ctx.createRadialGradient(
      u - 0.12,
      h - 0.95,
      0.05,
      u,
      h - 0.9,
      0.4,
    );
    g.addColorStop(0, copper[0]);
    g.addColorStop(1, copper[1]);
    ctx.fillStyle = "rgba(10, 25, 12, 0.3)";
    ctx.beginPath();
    ctx.arc(u + 0.2, h - 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(u, h - 0.9, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = copper[2];
    ctx.beginPath();
    ctx.arc(u, h - 0.9, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A building seen from above, as large as its footprint. */
export function planPicture(
  kind: Kind,
  w: number,
  h: number,
  game?: string,
): HTMLCanvasElement {
  const { element, ctx } = canvas(w, h);
  switch (kind) {
    case "huette":
      roof(ctx, 0.25, 0.3, 1.5, 1.45, "x", thatch[0], thatch[1], thatch[2]);
      rect(ctx, 1.25, 0.45, 0.2, 0.2, "#7a705e", "#3a3028");
      break;
    case "spielhaus": {
      const [flag, sign] = gameColours[game ?? ""] ?? ["#b0782e", "#f0e0b0"];
      const x = (w - 3) / 2;
      roof(ctx, x + 0.35, 0.35, 2.3, 2.3, "y", tiles[0], tiles[1], tiles[2]);
      ctx.fillStyle = flag;
      ctx.fillRect(x + 1.5, 0.55, 0.45, 0.22);
      ctx.fillStyle = sign;
      ctx.fillRect(x + 1.55, 0.63, 0.35, 0.05);
      break;
    }
    case "druckerei":
      roof(ctx, 0.3, 0.3, 2.4, 2.4, "x", slate[0], slate[1], slate[2]);
      rect(ctx, 0.7, 0.6, 0.3, 0.3, "#4a443c", "#2a2420");
      for (let i = 0; i < 4; i++)
        rect(ctx, 0.55 + i * 0.5, 2.85, 0.35, 0.1, "#f7f2e4");
      break;
    case "schafweide": {
      rect(ctx, 0.1, 0.1, w - 0.2, h - 0.2, "#86b356");
      ctx.strokeStyle = "#7a5230";
      ctx.lineWidth = 0.08;
      ctx.strokeRect(0.1, 0.1, w - 0.2, h - 0.2);
      roof(ctx, w - 1.4, 0.2, 1.2, 1.0, "x", thatch[0], thatch[1], thatch[2]);
      rect(ctx, 0.5, h - 0.9, 0.8, 0.3, "#6b4423");
      rect(ctx, 0.55, h - 0.85, 0.7, 0.2, "#4f8fcf");
      for (const [x, y] of [
        [0.9, 0.9],
        [1.8, 1.6],
        [2.6, 0.9],
        [2.4, 2.2],
        [1.3, 2.0],
      ])
        sheep(ctx, x, y);
      break;
    }
    case "ortstafel":
    case "anleitung":
      frame(ctx, w, h);
      if (kind === "anleitung")
        roof(ctx, 0.05, -0.1, w - 0.1, 0.4, "x", tiles[0], tiles[1], tiles[2]);
      break;
    case "chronik":
    case "spielidee":
      for (const y of [0.25, h - 0.25]) {
        shadow(ctx, 0.15, y - 0.22, w - 0.3, 0.44, 0.08);
        const g = ctx.createLinearGradient(0, y - 0.22, 0, y + 0.22);
        g.addColorStop(0, "#f5e9c8");
        g.addColorStop(1, "#c4a97a");
        ctx.fillStyle = g;
        ctx.fillRect(0.3, y - 0.22, w - 0.6, 0.44);
        rect(ctx, 0, y - 0.18, 0.3, 0.36, "#8a5a32");
        rect(ctx, w - 0.3, y - 0.18, 0.3, 0.36, "#8a5a32");
      }
      break;
    case "theater":
      theatre(ctx, w, h);
      break;
    case "kloster":
      kloster(ctx, w, h);
      break;
    case "damm":
      shadow(ctx, 0, 0.2, w, h - 0.4, 0.15);
      rect(ctx, 0, 0.2, w, h - 0.4, "#c4c2b8", "#6d6b64");
      rect(ctx, 0, 0.2, w, 0.3, "#e0ded4");
      break;
  }
  return element;
}

// --- Trees and Waldleute from above -------------------------------------------

export const planTreeSize = 1.3;

/** Six crowns from above: four firs, two broadleaf trees. */
export function planTreeAtlas(): HTMLCanvasElement {
  const { element, ctx } = canvas(planTreeSize * 6, planTreeSize);
  const firs = [
    ["#5a9550", "#1f4a2a", "#143520"],
    ["#66a05a", "#255432", "#173c24"],
    ["#4f8a5c", "#1c4434", "#122f25"],
    ["#62964d", "#2b5129", "#1b3a1c"],
  ];
  const c = planTreeSize / 2;
  firs.forEach(([light, mid, deep], i) => {
    const x = i * planTreeSize + c;
    const rnd = random(70 + i);
    ctx.fillStyle = "rgba(10, 25, 12, 0.35)";
    ctx.beginPath();
    ctx.arc(x + 0.12, c + 0.12, 0.44, 0, Math.PI * 2);
    ctx.fill();
    // A star of branches round the top.
    ctx.beginPath();
    const points = 11;
    for (let k = 0; k <= points * 2; k++) {
      const a = (k / (points * 2)) * Math.PI * 2;
      const r = k % 2 ? 0.3 : 0.46 + rnd() * 0.05;
      ctx.lineTo(x + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    const g = ctx.createRadialGradient(x - 0.12, c - 0.12, 0.02, x, c, 0.48);
    g.addColorStop(0, light);
    g.addColorStop(0.6, mid);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(x - 0.03, c - 0.03, 0.06, 0, Math.PI * 2);
    ctx.fill();
  });
  const leaves = [
    ["#8cbf5a", "#5f9a3c", "#3c6b27"],
    ["#a7c25a", "#78a03e", "#4f7426"],
  ];
  leaves.forEach(([light, mid, dark], i) => {
    const x = (4 + i) * planTreeSize + c;
    const rnd = random(90 + i);
    ctx.fillStyle = "rgba(10, 25, 12, 0.35)";
    ctx.beginPath();
    ctx.arc(x + 0.12, c + 0.12, 0.5, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 0.22;
      const bx = x + Math.cos(a) * d;
      const by = c + Math.sin(a) * d;
      const r = 0.22 + rnd() * 0.08;
      const g = ctx.createRadialGradient(
        bx - r * 0.4,
        by - r * 0.4,
        0.01,
        bx,
        by,
        r,
      );
      g.addColorStop(0, light);
      g.addColorStop(0.6, mid);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return element;
}

export const planWorkerSize = 0.6;

/** A Waldmensch from above: hat, shoulders and the axe. */
export function planWorker(): HTMLCanvasElement {
  const s = planWorkerSize;
  const { element, ctx } = canvas(s, s);
  const c = s / 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(c + 0.05, c + 0.05, 0.2, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#a8432f";
  ctx.beginPath();
  ctx.ellipse(c, c, 0.18, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(c + 0.12, c);
  ctx.lineTo(c + 0.26, c - 0.12);
  ctx.stroke();
  ctx.fillStyle = "#c9ced6";
  ctx.fillRect(c + 0.22, c - 0.18, 0.06, 0.08);
  const g = ctx.createRadialGradient(c - 0.03, c - 0.03, 0.01, c, c, 0.11);
  g.addColorStop(0, "#4d8a52");
  g.addColorStop(1, "#2f5a32");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, 0.1, 0, Math.PI * 2);
  ctx.fill();
  return element;
}
