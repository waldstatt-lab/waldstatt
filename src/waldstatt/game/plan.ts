/**
 * The top-down art for the plan view (iso.ts): buildings, trees and
 * Waldleute seen from straight above, painted in tile units at 64 pixels per
 * tile. The light comes from the upper left, as in the isometric art; shadows
 * fall to the lower right.
 */
import { iseColours, STAGE, type Kind } from "./config";
import { crowd, standBands } from "./art";

/** Canvas pixels per tile. */
export const PLAN_RES = 64;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = Math.ceil(w * PLAN_RES);
  element.height = Math.ceil(h * PLAN_RES);
  // On the CPU, as in art.ts: GPU canvases can lose their colours in WebGL.
  const ctx = element.getContext("2d", { willReadFrequently: true });
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

const redTiles = ["#c8402e", "#8c2a1e", "#5e1c14"] as const;
const blueSlate = ["#4f7fc0", "#2c5490", "#1d3a66"] as const;

/** A pyramid roof from above: four triangles meeting in the middle. */
function pyramid(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  [lit, dark, course]: readonly [string, string, string],
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const faces: [number, number, number, number, string][] = [
    [x, y, x + w, y, lit],
    [x, y, x, y + h, lit],
    [x, y + h, x + w, y + h, dark],
    [x + w, y, x + w, y + h, dark],
  ];
  for (const [ax, ay, bx, by, fill] of faces) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.fill();
  }
  ctx.strokeStyle = course;
  ctx.lineWidth = 0.04;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
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
  // The audience from above: shoulders, and a head, hair or hat.
  for (const s of crowd(w, h)) {
    ctx.fillStyle = s.shirt;
    ctx.beginPath();
    ctx.ellipse(s.u, s.v, 0.13, 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.hat ? "#2f5d34" : s.hair;
    ctx.beginPath();
    ctx.arc(s.u, s.v, s.hat ? 0.09 : 0.075, 0, Math.PI * 2);
    ctx.fill();
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

/** A bridge from above: planks across its axis between two rails. */
function bridge(ctx: Ctx, w: number, h: number, axis: "x" | "y") {
  if (axis === "y") {
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    [w, h] = [h, w];
  }
  shadow(ctx, 0, 0.15, w, 0.7, 0.12);
  rect(ctx, 0, 0.15, w, 0.7, "#b98a52");
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = 0.025;
  for (let x = 0.09; x < w; x += 0.18) {
    ctx.beginPath();
    ctx.moveTo(x, 0.15);
    ctx.lineTo(x, 0.85);
    ctx.stroke();
  }
  rect(ctx, 0, 0.13, w, 0.07, "#5a3a22");
  rect(ctx, 0, 0.8, w, 0.07, "#5a3a22");
}

/** A boat from above, along x: hull, deck, mast and furled sail. */
function boat(ctx: Ctx, w: number, h: number) {
  const v = h / 2;
  ctx.fillStyle = "rgba(10, 30, 60, 0.3)";
  ctx.beginPath();
  ctx.ellipse(w / 2 + 0.08, v + 0.08, w / 2 - 0.05, 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.15, v - 0.34);
  ctx.lineTo(w - 0.45, v - 0.34);
  ctx.quadraticCurveTo(w - 0.1, v - 0.2, w - 0.05, v);
  ctx.quadraticCurveTo(w - 0.1, v + 0.2, w - 0.45, v + 0.34);
  ctx.lineTo(0.15, v + 0.34);
  ctx.closePath();
  ctx.fillStyle = "#c9a46c";
  ctx.fill();
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 0.05;
  ctx.stroke();
  ctx.strokeStyle = "#a8834e";
  ctx.lineWidth = 0.02;
  for (let x = 0.35; x < w - 0.4; x += 0.2) {
    ctx.beginPath();
    ctx.moveTo(x, v - 0.32);
    ctx.lineTo(x, v + 0.32);
    ctx.stroke();
  }
  rect(ctx, 0.25, v - 0.05, w * 0.45 - 0.25, 0.1, "#f2ead6", "#b9ae94");
  ctx.fillStyle = "#4a3320";
  ctx.beginPath();
  ctx.arc(w * 0.45, v, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

const bookColours = ["#8c2a1e", "#2f5d34", "#2c5490", "#7a4e26"];

/** A stack of books from above, the top one turned a little. */
function books(ctx: Ctx, x: number, y: number) {
  shadow(ctx, x, y, 0.32, 0.22, 0.06);
  rect(ctx, x, y, 0.32, 0.22, bookColours[0], "#3a2614");
  rect(ctx, x + 0.04, y + 0.02, 0.28, 0.18, bookColours[2], "#3a2614");
}

/** A building seen from above, as large as its footprint. */
export function planPicture(
  kind: Kind,
  w: number,
  h: number,
  game?: string,
  /** The axis a bridge spans along. */
  axis: "x" | "y" = "x",
  /** Graves in a graveyard. */
  graves = 0,
): HTMLCanvasElement {
  const { element, ctx } = canvas(w, h);
  switch (kind) {
    case "huette":
      roof(ctx, 0.25, 0.3, 1.5, 1.45, "x", thatch[0], thatch[1], thatch[2]);
      rect(ctx, 1.25, 0.45, 0.2, 0.2, "#7a705e", "#3a3028");
      break;
    case "spielhaus": {
      if (game === "moto-devil") {
        roof(ctx, 0.4, 0.5, 2.6, 2.8, "y", ...redTiles);
        shadow(ctx, 3.0, 0.4, 1.5, 1.5, 0.6);
        pyramid(ctx, 3.0, 0.4, 1.5, 1.5, redTiles);
        rect(ctx, 3.3, 2.2, 1.3, 1.1, "#c0915a", "#4a3320");
        ctx.strokeStyle = "#8a5a32";
        ctx.lineWidth = 0.03;
        for (let k = 1; k < 6; k++) {
          ctx.beginPath();
          ctx.moveTo(3.3 + (1.3 * k) / 6, 2.2);
          ctx.lineTo(3.3 + (1.3 * k) / 6, 3.3);
          ctx.stroke();
        }
        rect(ctx, 3.62, 1.05, 0.26, 0.12, "#c23b2a");
        break;
      }
      if (game === "car-drive") {
        roof(ctx, 0.4, 0.5, 4.2, 2.8, "x", ...blueSlate);
        shadow(ctx, 2.2, 1.6, 0.6, 0.6, 0.3);
        pyramid(ctx, 2.2, 1.6, 0.6, 0.6, blueSlate);
        for (const x of [0.3, 4.7])
          rect(ctx, x - 0.05, 3.45, 0.1, 0.1, "#3a2614");
        break;
      }
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
      books(ctx, 2.75, 1.0);
      break;
    case "bibliothek": {
      const [colour] = gameColours[game ?? ""] ?? ["#5a3a22"];
      rect(ctx, 0.2, 0.2, 3.6, 2.6, "#cfc7b4", "#6f6656");
      roof(ctx, 0.35, 0.35, 3.3, 2.15, "x", slate[0], slate[1], slate[2]);
      // The board with the game's name, seen from above, over the door.
      rect(ctx, 1.05, 2.55, 1.9, 0.1, colour, "#3a2614");
      books(ctx, 0.55, 2.7);
      books(ctx, 2.95, 2.75);
      break;
    }
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
    case "steinbruch": {
      rect(ctx, 0, 0, w, h, "#c9c2b0");
      for (const [x, y, rw, rh, c] of [
        [0.1, 0.1, 1.3, 0.8, "#bdb8ad"],
        [1.3, 0.1, 1.3, 0.6, "#a29d92"],
        [2.5, 0.1, w - 2.6, 0.9, "#bdb8ad"],
        [0.1, 0.8, 0.7, 1.1, "#a29d92"],
      ] as const) {
        shadow(ctx, x, y, rw, rh, 0.15);
        rect(ctx, x, y, rw, rh, c, "#5f5b53");
      }
      for (const [x, y] of [
        [1.4, 1.6],
        [2.1, 1.7],
        [0.5, 2.2],
      ])
        rect(ctx, x, y, 0.6, 0.55, "#ddd8cc", "#6f6a60");
      ctx.strokeStyle = "#7a4e26";
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(3.0, 1.5);
      ctx.lineTo(3.25, 1.9);
      ctx.lineTo(3.5, 2.3);
      ctx.moveTo(3.25, 1.9);
      ctx.lineTo(2.6, 1.9);
      ctx.stroke();
      break;
    }
    case "klause":
      shadow(ctx, 0.5, 0.5, 1.8, 1.7);
      roof(ctx, 0.5, 0.5, 1.8, 1.7, "y", "#8a7a62", "#5e5242", "#463c30");
      rect(ctx, 0.55, 2.35, 0.45, 0.4, "#c9a46c", "#6b4423");
      ctx.fillStyle = "#c9a46c";
      ctx.beginPath();
      ctx.arc(2.5, 2.6, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "theater":
      theatre(ctx, w, h);
      break;
    case "kloster":
      kloster(ctx, w, h);
      break;
    case "bruecke":
      bridge(ctx, w, h, axis);
      break;
    case "hafen":
      shadow(ctx, 0.05, 0.05, w - 0.1, h - 0.1, 0.1);
      rect(ctx, 0.05, 0.05, w - 0.1, h - 0.1, "#b98a52", "#4a3320");
      ctx.strokeStyle = "#8a5a32";
      ctx.lineWidth = 0.02;
      for (let x = 0.25; x < w; x += 0.22) {
        ctx.beginPath();
        ctx.moveTo(x, 0.05);
        ctx.lineTo(x, h - 0.05);
        ctx.stroke();
      }
      roof(ctx, 0.25, 0.2, 1.3, 0.9, "x", tiles[0], tiles[1], tiles[2]);
      rect(ctx, w - 0.55, 0.3, 0.15, 0.15, "#6b4423");
      rect(ctx, w - 0.5, 0.37, 0.05, 0.9, "#5a3a22");
      rect(ctx, 1.8, 0.3, 0.3, 0.3, "#a8743f", "#4a3320");
      rect(ctx, 1.85, 0.7, 0.3, 0.3, "#a8743f", "#4a3320");
      for (const [x, y] of [
        [0.5, 1.5],
        [0.85, 1.6],
      ]) {
        ctx.fillStyle = "#9a6a3c";
        ctx.beginPath();
        ctx.arc(x, y, 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "schiff":
      boat(ctx, w, h);
      break;
    case "damm":
      shadow(ctx, 0, 0.2, w, h - 0.4, 0.15);
      rect(ctx, 0, 0.2, w, h - 0.4, "#c4c2b8", "#6d6b64");
      rect(ctx, 0, 0.2, w, 0.3, "#e0ded4");
      break;
    case "steinhaus":
      roof(ctx, 0.3, 0.3, 2.4, 2.4, "x", ...tiles);
      rect(ctx, 0.7, 0.6, 0.3, 0.3, "#4a443c", "#2a2420");
      break;
    case "getreidehof":
      for (const [x, y, fw, fh] of [
        [0.1, 1.9, w - 0.2, h - 2.0],
        [2.3, 0.1, w - 2.4, 1.7],
      ]) {
        rect(ctx, x, y, fw, fh, "#c9a94a");
        ctx.strokeStyle = "#8a6a2c";
        ctx.lineWidth = 0.04;
        for (let k = x + 0.15; k < x + fw; k += 0.28) {
          ctx.beginPath();
          ctx.moveTo(k, y + 0.05);
          ctx.lineTo(k, y + fh - 0.05);
          ctx.stroke();
        }
      }
      roof(ctx, 0.2, 0.2, 1.8, 1.4, "x", ...thatch);
      break;
    case "viehhof": {
      rect(ctx, 0.1, 0.1, w - 0.2, h - 0.2, "#7fa84c");
      rect(ctx, 0.1, 0.1, 2.3, 1.8, "#9c8a62");
      roof(ctx, 0.2, 0.2, 2.1, 1.5, "x", ...tiles);
      ctx.strokeStyle = "#7a5230";
      ctx.lineWidth = 0.08;
      ctx.strokeRect(0.1, 0.1, w - 0.2, h - 0.2);
      const animal = (x: number, y: number, fill: string, r: number) => {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(x + 0.05, y + 0.05, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      animal(3.2, 1.4, "#8a5a32", 0.28);
      animal(4.2, 2.2, "#f2ece0", 0.28);
      animal(2.9, 2.7, "#f0b3ac", 0.2);
      animal(3.6, 3.2, "#f0b3ac", 0.2);
      for (const [x, y] of [
        [1.0, 2.6],
        [1.4, 3.0],
        [0.7, 3.2],
        [1.8, 2.5],
      ])
        animal(x, y, "#fbf6e9", 0.08);
      break;
    }
    case "muehle":
      roof(ctx, 0.3, 0.3, 2.1, 2.3, "y", ...tiles);
      rect(ctx, 2.45, 0.9, 0.2, 1.1, "#5a3a22", "#3a2614");
      break;
    case "baeckerei":
      roof(ctx, 0.3, 0.3, 2.0, 2.3, "x", ...tiles);
      ctx.fillStyle = "#b9ae94";
      ctx.beginPath();
      ctx.arc(2.65, 1.55, 0.35, 0, Math.PI * 2);
      ctx.fill();
      rect(ctx, 0.45, 2.75, 0.95, 0.2, "#b98a52", "#4a3320");
      break;
    case "brauerei":
      roof(ctx, 0.3, 0.3, 2.1, 2.1, "y", ...slate);
      pyramid(ctx, 1.15, 1.15, 0.45, 0.45, slate);
      for (const [x, y] of [
        [2.6, 0.6],
        [2.65, 1.0],
        [2.6, 1.4],
        [0.7, 2.7],
      ]) {
        ctx.fillStyle = "#9a6a3c";
        ctx.beginPath();
        ctx.arc(x, y, 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "kirche":
      roof(ctx, 0.6, 1.7, 2.8, h - 2.0, "y", ...tiles);
      shadow(ctx, 1.3, 0.3, 1.4, 1.4, 0.6);
      pyramid(ctx, 1.3, 0.3, 1.4, 1.4, slate);
      break;
    case "friedhof": {
      rect(ctx, 0.1, 0.1, w - 0.2, h - 0.2, "#6f9a48");
      ctx.strokeStyle = "#cfc7b4";
      ctx.lineWidth = 0.15;
      ctx.strokeRect(0.15, 0.15, w - 0.3, h - 0.3);
      ctx.fillStyle = "#24502c";
      ctx.beginPath();
      ctx.arc(0.6, 0.6, 0.35, 0, Math.PI * 2);
      ctx.fill();
      const spots: [number, number][] = [];
      for (let v = 0.75; v < h - 0.3; v += 0.65)
        for (let u = 0.75; u < w - 0.3; u += 0.55)
          if (!(u < 1.1 && v < 1.1)) spots.push([u, v]);
      for (const [x, y] of spots.slice(0, graves))
        rect(ctx, x - 0.12, y - 0.06, 0.24, 0.12, "#a9a497", "#6f6a60");
      break;
    }
    case "ise":
      roof(ctx, 0.3, 0.3, 2.4, 2.4, "x", ...slate);
      rect(ctx, 0.6, 0.6, 0.4, 0.4, "#2a2420");
      rect(ctx, 0.5, 2.62, 2.0, 0.12, iseColours.board, "#2a2420");
      break;
    case "brot": {
      shadow(ctx, 0.2, 0.2, w - 0.4, h - 0.4, 0.1);
      rect(ctx, 0.2, 0.2, w - 0.4, h - 0.4, "#b98a52", "#4a3320");
      const colours = ["#c23b2a", "#f4d24a", "#2a62b8", "#f2f2f2"];
      for (let k = 0; k < 8; k++)
        rect(ctx, 0.3 + ((w - 0.6) * k) / 8, 0.25, 0.25, 0.1, colours[k % 4]);
      for (const x of [0.8, 1.6, 2.3]) {
        ctx.fillStyle = "#8a5a32";
        ctx.beginPath();
        ctx.arc(x, 0.85, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c47a3a";
        ctx.beginPath();
        ctx.arc(x, 0.85, 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  return element;
}

/** A tombstone from above. */
export function planTomb(): HTMLCanvasElement {
  const { element, ctx } = canvas(0.5, 0.5);
  rect(ctx, 0.15, 0.2, 0.26, 0.16, "rgba(10, 25, 12, 0.3)");
  rect(ctx, 0.1, 0.15, 0.26, 0.14, "#a9a497", "#6f6a60");
  return element;
}

/** The fire in the first clearing, from above. */
export function planFire(): HTMLCanvasElement {
  const { element, ctx } = canvas(1, 1);
  ctx.fillStyle = "#3a2a1e";
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.3, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    ctx.fillStyle = "#9a958a";
    ctx.beginPath();
    ctx.arc(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.06, 0, 7);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.25);
  g.addColorStop(0, "rgba(255, 240, 170, 1)");
  g.addColorStop(1, "rgba(230, 100, 30, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.25, 0, Math.PI * 2);
  ctx.fill();
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

/** A Waldmensch from above: hat or kerchief, shoulders and the axe. */
export function planWorker(woman = false): HTMLCanvasElement {
  const s = planWorkerSize;
  const { element, ctx } = canvas(s, s);
  const c = s / 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(c + 0.05, c + 0.05, 0.2, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = woman ? "#3e6690" : "#a8432f";
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
  g.addColorStop(0, woman ? "#f0c060" : "#4d8a52");
  g.addColorStop(1, woman ? "#c8902e" : "#2f5a32");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, 0.1, 0, Math.PI * 2);
  ctx.fill();
  return element;
}

/** The axe in its stump, or the saw on its log, from above, about a tile across. */
export function planItem(item: "axe" | "saw"): HTMLCanvasElement {
  const { element, ctx } = canvas(1, 1);
  if (item === "axe") {
    ctx.fillStyle = "#c9a46c";
    ctx.beginPath();
    ctx.arc(0.45, 0.55, 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6b4423";
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.strokeStyle = "#7a4e26";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(0.45, 0.5);
    ctx.lineTo(0.9, 0.1);
    ctx.stroke();
    rect(ctx, 0.3, 0.4, 0.3, 0.16, "#9aa4ad");
  } else {
    rect(ctx, 0.15, 0.4, 0.75, 0.25, "#7a4e26");
    rect(ctx, 0.05, 0.3, 0.9, 0.12, "#c2cad1");
    ctx.strokeStyle = "#8a5a32";
    ctx.lineWidth = 0.06;
    ctx.strokeRect(0.07, 0.12, 0.86, 0.2);
  }
  return element;
}

/** A raven from above, wings spread, facing right, about a tile across. */
export function planRaven(): HTMLCanvasElement {
  const { element, ctx } = canvas(1, 1);
  ctx.fillStyle = "#16141c";
  ctx.beginPath();
  ctx.ellipse(0.5, 0.5, 0.2, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.55, 0.47);
  ctx.quadraticCurveTo(0.45, 0.2, 0.3, 0.05);
  ctx.quadraticCurveTo(0.42, 0.3, 0.42, 0.5);
  ctx.quadraticCurveTo(0.42, 0.7, 0.3, 0.95);
  ctx.quadraticCurveTo(0.45, 0.8, 0.55, 0.53);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.32, 0.47);
  ctx.lineTo(0.18, 0.42);
  ctx.lineTo(0.18, 0.58);
  ctx.lineTo(0.32, 0.53);
  ctx.fill();
  ctx.fillStyle = "#3a3630";
  ctx.beginPath();
  ctx.moveTo(0.7, 0.47);
  ctx.lineTo(0.78, 0.5);
  ctx.lineTo(0.7, 0.53);
  ctx.fill();
  return element;
}
