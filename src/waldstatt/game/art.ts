/**
 * The game's pixel art, drawn for the Waldstatt with canvas rectangles at one
 * pixel per world unit: trees, Waldleute, buildings and ground. North is up;
 * buildings are seen from above at a slight angle and stay inside their
 * footprint, so trees south of them overlap them like trees in front.
 * Nothing here is traced or copied from another game.
 */
import { TILE } from "./config";
import type { Kind } from "./config";
import { hash } from "./world";

export const palette = {
  floor: "#1c3420",
  floorSpeck: "#244229",
  meadow: "#5b8b3c",
  meadowLight: "#68993f",
  meadowDark: "#4e7b34",
  earth: "#8b7653",
  stump: "#6e4b2a",
  stumpTop: "#b08a5a",
  water: "#2d6aa0",
  waterLight: "#4689c0",
  waterDark: "#24557f",
  lake: "#29609a",
  trunk: "#4b301d",
  parchment: "#efe0b9",
  parchmentDark: "#d4be8d",
  ink: "#5b4330",
  mark: "#d8432f",
};

const firShades = [
  { light: "#2f6b3c", mid: "#22552f", dark: "#173f23", edge: "#0f2c18" },
  { light: "#3a7a43", mid: "#2b6236", dark: "#1c4627", edge: "#12321b" },
  { light: "#2b6046", mid: "#1f4d37", dark: "#163a29", edge: "#0e2a1d" },
];
const leaf = {
  light: "#6a9a3f",
  mid: "#4f8233",
  dark: "#386227",
  edge: "#264818",
};

export const treeSize = { w: 20, h: 30 };

function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = w;
  element.height = h;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.imageSmoothingEnabled = false;
  return { element, ctx };
}

type Ctx = CanvasRenderingContext2D;

function rect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function fir(ctx: Ctx, ox: number, shade: (typeof firShades)[number]) {
  rect(ctx, ox + 4, 26, 13, 3, "rgba(0,0,0,0.28)");
  rect(ctx, ox + 9, 23, 2, 5, palette.trunk);
  const tiers = [
    { top: 1, h: 9, hw: 4 },
    { top: 7, h: 10, hw: 6.5 },
    { top: 14, h: 11, hw: 9 },
  ];
  for (const tier of tiers) {
    for (let r = 0; r < tier.h; r++) {
      const hw = Math.round(1 + (tier.hw - 1) * (r / (tier.h - 1)));
      const y = tier.top + r;
      const last = r === tier.h - 1;
      for (let x = 10 - hw; x < 10 + hw; x++) {
        const edge = x === 10 - hw || x === 10 + hw - 1;
        let color = x < 10 ? shade.light : shade.mid;
        if (x >= 12 + (r >> 2)) color = shade.dark;
        if (edge || last) color = shade.edge;
        // Needles: a few darker pixels break the flat shapes.
        if (!edge && !last && hash(x, y, ox + 3) < 0.12) color = shade.dark;
        rect(ctx, ox + x, y, 1, 1, color);
      }
    }
  }
  rect(ctx, ox + 9, 0, 2, 2, shade.light);
}

function broadleaf(ctx: Ctx, ox: number) {
  rect(ctx, ox + 3, 26, 15, 3, "rgba(0,0,0,0.28)");
  rect(ctx, ox + 9, 19, 2, 9, palette.trunk);
  const cx = 10;
  const cy = 12;
  for (let y = 2; y < 23; y++) {
    for (let x = 1; x < 19; x++) {
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) * 1.05;
      const lumpy = 8.6 + (hash(x, y, 21) - 0.5) * 1.6;
      const d = Math.hypot(dx, dy);
      if (d > lumpy) continue;
      let color = leaf.mid;
      if (dx + dy < -4) color = leaf.light;
      else if (dx + dy > 4) color = leaf.dark;
      if (d > lumpy - 1) color = leaf.edge;
      else if (hash(x, y, 22) < 0.14) color = leaf.dark;
      rect(ctx, ox + x, y, 1, 1, color);
    }
  }
}

/** Four trees side by side: three firs and one broadleaf tree. */
export function treeAtlas(): HTMLCanvasElement {
  const { element, ctx } = canvas(treeSize.w * 4, treeSize.h);
  firShades.forEach((shade, i) => fir(ctx, i * treeSize.w, shade));
  broadleaf(ctx, 3 * treeSize.w);
  return element;
}

/** A red ribbon round a trunk: marked for felling. */
export function markSprite(): HTMLCanvasElement {
  const { element, ctx } = canvas(6, 5);
  rect(ctx, 0, 1, 6, 3, palette.mark);
  rect(ctx, 0, 1, 6, 1, "#f07a5c");
  rect(ctx, 4, 3, 2, 2, "#a52c1f");
  return element;
}

export const workerSize = { w: 12, h: 16 };

/** A Waldmensch facing right: stand, two walking frames, two chopping. */
export function workerAtlas(): HTMLCanvasElement {
  const { element, ctx } = canvas(workerSize.w * 5, workerSize.h);
  const skin = "#e2b58a";
  const hat = "#2f5d34";
  const shirt = "#a8432f";
  const shirtDark = "#7d3022";
  const trousers = "#4a3b2b";
  const axeHandle = "#8a5a32";
  const axeHead = "#c9ccd1";
  for (let frame = 0; frame < 5; frame++) {
    const o = frame * workerSize.w;
    rect(ctx, o + 2, 14, 8, 2, "rgba(0,0,0,0.3)");
    // Legs: apart or together.
    const stride = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    rect(ctx, o + 4 + stride, 11, 2, 4, trousers);
    rect(ctx, o + 7 - stride, 11, 2, 4, trousers);
    rect(ctx, o + 3, 6, 7, 5, shirt);
    rect(ctx, o + 3, 10, 7, 1, shirtDark);
    rect(ctx, o + 4, 2, 5, 4, skin);
    rect(ctx, o + 8, 3, 1, 1, "#3a2a20");
    rect(ctx, o + 3, 1, 7, 2, hat);
    rect(ctx, o + 2, 2, 9, 1, hat);
    if (frame === 3) {
      // Axe raised behind the head.
      rect(ctx, o + 2, 0, 1, 7, axeHandle);
      rect(ctx, o + 0, 0, 3, 2, axeHead);
    } else if (frame === 4) {
      // Axe swung forward.
      rect(ctx, o + 9, 8, 3, 1, axeHandle);
      rect(ctx, o + 10, 6, 2, 3, axeHead);
    } else {
      // Axe on the shoulder.
      rect(ctx, o + 2, 3, 1, 6, axeHandle);
      rect(ctx, o + 1, 3, 2, 2, axeHead);
    }
  }
  return element;
}

// --- Buildings ---------------------------------------------------------

interface HouseStyle {
  wall: string;
  wallDark: string;
  roof: string;
  roofLight: string;
  roofDark: string;
  roofKind: "thatch" | "slate" | "tile";
  wallH: number;
  stone?: boolean;
}

function house(
  ctx: Ctx,
  ox: number,
  oy: number,
  W: number,
  H: number,
  s: HouseStyle,
) {
  rect(ctx, ox + 2, oy + H - 3, W - 2, 3, "rgba(0,0,0,0.3)");
  const wallTop = oy + H - s.wallH - 2;
  rect(ctx, ox + 2, wallTop, W - 4, s.wallH, s.wall);
  rect(ctx, ox + 2, wallTop + s.wallH - 1, W - 4, 1, s.wallDark);
  if (s.stone) {
    for (let y = wallTop + 1; y < wallTop + s.wallH - 1; y += 3)
      for (let x = ox + 3 + ((y >> 1) % 2) * 2; x < ox + W - 3; x += 5)
        rect(ctx, x, y, 3, 1, s.wallDark);
  }
  const roofTop = oy + 1;
  const roofH = wallTop - roofTop + 2;
  const ridge = roofTop + Math.floor(roofH * 0.42);
  rect(ctx, ox + 1, roofTop, W - 2, roofH, s.roof);
  rect(ctx, ox + 1, roofTop, W - 2, ridge - roofTop, s.roofLight);
  rect(ctx, ox + 1, ridge, W - 2, 1, s.roofDark);
  rect(ctx, ox + 1, roofTop + roofH - 1, W - 2, 1, s.roofDark);
  rect(ctx, ox + 1, roofTop, 1, roofH, s.roofDark);
  rect(ctx, ox + W - 2, roofTop, 1, roofH, s.roofDark);
  for (let y = roofTop + 1; y < roofTop + roofH - 1; y++) {
    if (y === ridge) continue;
    for (let x = ox + 2; x < ox + W - 2; x++) {
      const h = hash(x, y, 31);
      if (s.roofKind === "thatch" && (x + (y >> 1)) % 3 === 0 && h < 0.6)
        rect(ctx, x, y, 1, 1, s.roofDark);
      if (
        s.roofKind === "slate" &&
        (y - roofTop) % 3 === 0 &&
        (x + y) % 4 !== 0
      )
        rect(ctx, x, y, 1, 1, s.roofDark);
      if (
        s.roofKind === "tile" &&
        ((y - roofTop) % 2 === 0 || x % 3 === 0) &&
        h < 0.35
      )
        rect(ctx, x, y, 1, 1, s.roofDark);
    }
  }
  return { wallTop, ridge };
}

function door(ctx: Ctx, x: number, bottom: number, color = "#4a2f1c") {
  rect(ctx, x, bottom - 6, 4, 6, color);
  rect(ctx, x + 3, bottom - 3, 1, 1, "#d8b45a");
}

function pane(ctx: Ctx, x: number, y: number) {
  rect(ctx, x, y, 3, 3, "#3a2a1e");
  rect(ctx, x, y, 3, 1, "#f2d27a");
  rect(ctx, x + 1, y + 1, 1, 1, "#f2d27a");
}

const wood = {
  wall: "#9a6a3c",
  wallDark: "#6b4423",
  roof: "#b99442",
  roofLight: "#d0ad58",
  roofDark: "#8a6c2c",
  roofKind: "thatch" as const,
};

function hut(ctx: Ctx, W: number, H: number) {
  house(ctx, 0, 0, W, H, { ...wood, wallH: 10 });
  door(ctx, W / 2 - 2, H - 2);
  pane(ctx, 5, H - 9);
}

const gameColors: Record<string, [string, string]> = {
  "moto-devil": ["#c23b2a", "#f4d24a"],
  "car-drive": ["#2a62b8", "#f2f2f2"],
};

function spielhaus(ctx: Ctx, W: number, H: number, game?: string) {
  const [flag, sign] = gameColors[game ?? ""] ?? ["#b0782e", "#f0e0b0"];
  const { wallTop } = house(ctx, 0, 0, W, H, {
    wall: "#b07a45",
    wallDark: "#74491f",
    roof: "#8e3f2c",
    roofLight: "#a8513b",
    roofDark: "#682c1e",
    roofKind: "tile",
    wallH: 14,
  });
  door(ctx, W / 2 - 2, H - 2);
  pane(ctx, 6, wallTop + 3);
  pane(ctx, W - 9, wallTop + 3);
  // A sign in the game's colours over the door, and a flag on the roof.
  rect(ctx, W / 2 - 8, wallTop + 1, 16, 4, flag);
  rect(ctx, W / 2 - 6, wallTop + 2, 12, 2, sign);
  rect(ctx, W - 9, 3, 1, 12, "#3a2a1e");
  rect(ctx, W - 15, 3, 6, 4, flag);
  rect(ctx, W - 15, 5, 6, 1, sign);
  if (game === "moto-devil") {
    // A wheel on the roof.
    for (let a = 0; a < 16; a++) {
      const x = 12 + Math.round(Math.cos((a / 16) * Math.PI * 2) * 4);
      const y = 11 + Math.round(Math.sin((a / 16) * Math.PI * 2) * 4);
      rect(ctx, x, y, 1, 1, "#2a2420");
    }
    rect(ctx, 11, 10, 2, 2, "#2a2420");
  } else if (game === "car-drive") {
    // A little car on the roof.
    rect(ctx, 7, 10, 11, 4, flag);
    rect(ctx, 9, 8, 6, 2, "#9ecbf0");
    rect(ctx, 8, 14, 2, 1, "#2a2420");
    rect(ctx, 15, 14, 2, 1, "#2a2420");
  }
}

function druckerei(ctx: Ctx, W: number, H: number) {
  const { wallTop } = house(ctx, 0, 0, W, H, {
    wall: "#c9bfa8",
    wallDark: "#8f8672",
    roof: "#5a6470",
    roofLight: "#6e7987",
    roofDark: "#424a54",
    roofKind: "slate",
    wallH: 14,
    stone: true,
  });
  rect(ctx, 8, 2, 5, 9, "#7a6a5a");
  rect(ctx, 8, 2, 5, 1, "#3a3028");
  door(ctx, W / 2 - 2, H - 2);
  pane(ctx, 6, wallTop + 3);
  // Printed sheets drying on a line.
  rect(ctx, W - 20, wallTop + 2, 16, 1, "#3a2a1e");
  for (let i = 0; i < 3; i++) {
    rect(ctx, W - 19 + i * 5, wallTop + 3, 4, 5, "#f6f1e3");
    rect(ctx, W - 18 + i * 5, wallTop + 4, 2, 1, "#2a2420");
    rect(ctx, W - 18 + i * 5, wallTop + 6, 2, 1, "#2a2420");
  }
}

function schafweide(ctx: Ctx, W: number, H: number) {
  rect(ctx, 0, 0, W, H, palette.meadowLight);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (hash(x, y, 41) < 0.08) rect(ctx, x, y, 1, 1, palette.meadowDark);
  const post = "#6b4423";
  const rail = "#9a6a3c";
  rect(ctx, 0, 1, W, 1, rail);
  rect(ctx, 0, H - 3, W, 1, rail);
  rect(ctx, 0, 1, 1, H - 3, rail);
  rect(ctx, W - 1, 1, 1, H - 3, rail);
  for (let x = 0; x < W; x += 8) {
    rect(ctx, x, 0, 2, 3, post);
    rect(ctx, x, H - 4, 2, 3, post);
  }
  for (let y = 0; y < H; y += 8) {
    rect(ctx, 0, y, 2, 3, post);
    rect(ctx, W - 2, y, 2, 3, post);
  }
  // A shelter in the corner and a trough.
  house(ctx, W - 20, 3, 16, 14, { ...wood, wallH: 5 });
  rect(ctx, 6, H - 10, 10, 3, "#6b4423");
  rect(ctx, 7, H - 10, 8, 1, palette.waterLight);
  const sheep = [
    [10, 8],
    [24, 14],
    [36, 6],
    [30, 26],
    [14, 22],
  ];
  for (const [x, y] of sheep) {
    rect(ctx, x, y + 4, 7, 1, "rgba(0,0,0,0.25)");
    rect(ctx, x, y, 7, 4, "#f2eee2");
    rect(ctx, x, y + 3, 7, 1, "#c9c3b2");
    rect(ctx, x + 1, y - 1, 4, 1, "#fbf8ef");
    rect(ctx, x + 6, y, 2, 3, "#3a3330");
    rect(ctx, x + 1, y + 4, 1, 1, "#3a3330");
    rect(ctx, x + 5, y + 4, 1, 1, "#3a3330");
  }
}

function ortstafel(ctx: Ctx, W: number, H: number) {
  rect(ctx, W / 2 - 4, H - 3, 9, 2, "rgba(0,0,0,0.3)");
  rect(ctx, W / 2 - 1, 6, 2, H - 7, "#5a3a20");
  rect(ctx, 1, 2, W - 2, 8, "#5a3a20");
  rect(ctx, 2, 3, W - 4, 6, "#c89a5a");
  rect(ctx, 3, 4, W - 7, 1, palette.ink);
  rect(ctx, 3, 6, W - 9, 1, palette.ink);
}

function anleitung(ctx: Ctx, W: number, H: number) {
  rect(ctx, 3, H - 3, W - 6, 2, "rgba(0,0,0,0.3)");
  rect(ctx, 4, 4, 2, H - 5, "#5a3a20");
  rect(ctx, W - 6, 4, 2, H - 5, "#5a3a20");
  rect(ctx, 2, 1, W - 4, 2, "#8e3f2c");
  rect(ctx, 3, 3, W - 6, 9, "#9a6a3c");
  for (let i = 0; i < 2; i++) {
    const x = 5 + i * 12;
    rect(ctx, x, 4, 10, 7, "#f6f1e3");
    rect(ctx, x + 1, 5, 6, 1, "#2a2420");
    for (let y = 7; y < 10; y++)
      rect(ctx, x + 1, y, 8 - (y % 2) * 3, 1, "#7a7064");
  }
}

function theater(ctx: Ctx, W: number, H: number) {
  rect(ctx, 0, 0, W, H, palette.earth);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (hash(x, y, 51) < 0.06) rect(ctx, x, y, 1, 1, "#7a6747");
  // Benches in half rings facing the stage.
  const cx = W / 2;
  const cy = 18;
  for (let y = 22; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.25);
      if (d < 12 || d > 46) continue;
      const ring = Math.floor((d - 12) / 6);
      const inRing = (d - 12) % 6;
      if (inRing < 2.4) rect(ctx, x, y, 1, 1, ring % 2 ? "#9a6a3c" : "#a8763f");
      else if (inRing < 3.2) rect(ctx, x, y, 1, 1, "#5e4429");
    }
  }
  // The stage, its back wall and the curtain.
  rect(ctx, 6, 4, W - 12, 18, "#a8743f");
  for (let x = 6; x < W - 6; x += 4) rect(ctx, x, 12, 1, 10, "#8a5a32");
  rect(ctx, 6, 21, W - 12, 2, "#6b4423");
  rect(ctx, 4, 0, W - 8, 6, "#5a3a20");
  rect(ctx, 8, 1, W - 16, 10, "#8c2b33");
  for (let x = 9; x < W - 8; x += 3) rect(ctx, x, 1, 1, 10, "#6e1f27");
  rect(ctx, 8, 1, W - 16, 1, "#d8b45a");
  rect(ctx, 4, 0, 4, 22, "#6b4423");
  rect(ctx, W - 8, 0, 4, 22, "#6b4423");
}

function kloster(ctx: Ctx, W: number, H: number) {
  const wall = "#e7ddcb";
  const wallDark = "#b9ad97";
  const roof = "#7c3f32";
  const roofLight = "#97513f";
  const copper = "#5fa58c";
  const copperLight = "#8ccbb0";
  rect(ctx, 0, 0, W, H, "#cfc6b0");
  rect(ctx, 0, H - 3, W, 3, "rgba(0,0,0,0.2)");
  // Courtyards between the wings.
  rect(ctx, 14, 14, W - 28, H - 40, "#6f9a4a");
  const wing = (x: number, y: number, w: number, h: number) => {
    rect(ctx, x, y, w, h, roof);
    rect(ctx, x, y, w, Math.floor(h * 0.45), roofLight);
    rect(ctx, x, y + h - 4, w, 4, wall);
    rect(ctx, x, y + h - 1, w, 1, wallDark);
    for (let wx = x + 3; wx < x + w - 2; wx += 5)
      rect(ctx, wx, y + h - 3, 2, 2, "#4a5a6a");
  };
  wing(2, 2, W - 4, 14);
  wing(2, 2, 14, H - 26);
  wing(W - 16, 2, 14, H - 26);
  wing(2, H - 38, 52, 16);
  wing(W - 54, H - 38, 52, 16);
  // The church: nave from the front into the courtyard, then the front.
  wing(W / 2 - 13, 18, 26, H - 44);
  rect(ctx, W / 2 - 22, H - 26, 44, 20, wall);
  rect(ctx, W / 2 - 22, H - 7, 44, 1, wallDark);
  rect(ctx, W / 2 - 3, H - 16, 6, 9, "#4a2f1c");
  for (const side of [-1, 1]) {
    const tx = W / 2 + side * 17 - 6;
    rect(ctx, tx, H - 34, 12, 28, wall);
    rect(ctx, tx, H - 34, 12, 1, wallDark);
    rect(ctx, tx + 4, H - 24, 4, 4, "#e9d27a");
    rect(ctx, tx + 5, H - 23, 2, 1, "#3a2a1e");
    // Copper domes with a small lantern.
    rect(ctx, tx + 1, H - 42, 10, 9, copper);
    rect(ctx, tx + 2, H - 44, 8, 2, copper);
    rect(ctx, tx + 2, H - 42, 3, 6, copperLight);
    rect(ctx, tx + 5, H - 47, 2, 3, "#3f7a66");
  }
  // The square in front.
  rect(ctx, 0, H - 6, W, 6, "#d9d0bb");
  for (let x = 2; x < W; x += 6) rect(ctx, x, H - 4, 3, 1, "#c2b89f");
}

function damm(ctx: Ctx, W: number, H: number) {
  rect(ctx, 0, 0, W, H, "#8f8e86");
  rect(ctx, 0, 0, W, 7, "#6f6e68");
  rect(ctx, 0, 7, W, 3, "#c4c2b8");
  rect(ctx, 0, 10, W, H - 10, "#a3a199");
  for (let x = 4; x < W; x += 9) rect(ctx, x, 10, 1, H - 10, "#86857e");
  for (let x = 0; x < W; x += 4) rect(ctx, x, 6, 2, 1, "#5a5954");
  rect(ctx, 0, H - 2, W, 2, "rgba(0,0,0,0.25)");
}

/** A building's picture, as large as its footprint. */
export function buildingCanvas(
  kind: Kind,
  w: number,
  h: number,
  game?: string,
): HTMLCanvasElement {
  const W = w * TILE;
  const H = h * TILE;
  const { element, ctx } = canvas(W, H);
  switch (kind) {
    case "huette":
      hut(ctx, W, H);
      break;
    case "spielhaus":
      spielhaus(ctx, W, H, game);
      break;
    case "druckerei":
      druckerei(ctx, W, H);
      break;
    case "schafweide":
      schafweide(ctx, W, H);
      break;
    case "ortstafel":
      ortstafel(ctx, W, H);
      break;
    case "anleitung":
      anleitung(ctx, W, H);
      break;
    case "theater":
      theater(ctx, W, H);
      break;
    case "kloster":
      kloster(ctx, W, H);
      break;
    case "damm":
      damm(ctx, W, H);
      break;
    default:
      break;
  }
  return element;
}

/** The rolled-up head of a scroll, two tiles high. */
export function scrollHead(w: number): HTMLCanvasElement {
  const W = w * TILE;
  const H = 2 * TILE;
  const { element, ctx } = canvas(W, H);
  rect(ctx, 3, 20, W - 6, 4, "rgba(0,0,0,0.25)");
  rect(ctx, 4, 6, W - 8, 15, palette.parchmentDark);
  rect(ctx, 4, 7, W - 8, 5, palette.parchment);
  rect(ctx, 4, 12, W - 8, 1, "#fff6dc");
  rect(ctx, 4, 19, W - 8, 2, "#b59c6a");
  for (const x of [0, W - 5]) {
    rect(ctx, x, 3, 5, 21, "#6b4423");
    rect(ctx, x + 1, 4, 2, 19, "#9a6a3c");
  }
  rect(ctx, W / 2 - 3, 10, 6, 6, "#a8323a");
  rect(ctx, W / 2 - 2, 11, 2, 2, "#d0545c");
  rect(ctx, W / 2 - 1, 16, 2, 6, "#a8323a");
  rect(ctx, 4, H - 4, W - 8, 4, palette.parchment);
  return element;
}

/** One tile of an unrolled scroll: parchment with lines of ink. */
export function parchmentTiles(): HTMLCanvasElement {
  const { element, ctx } = canvas(TILE * 4, TILE);
  for (let v = 0; v < 4; v++) {
    const o = v * TILE;
    rect(ctx, o, 0, TILE, TILE, palette.parchment);
    for (let y = 3; y < TILE; y += 4) {
      let x = o + 1;
      while (x < o + TILE - 1) {
        const len = 2 + Math.floor(hash(x, y, 60 + v) * 5);
        rect(ctx, x, y, Math.min(len, o + TILE - 1 - x), 1, palette.ink);
        x += len + 1;
      }
    }
  }
  return element;
}

// --- Ground --------------------------------------------------------------

/** Texels per tile in the ground textures. */
export const groundRes = 8;

export type GroundKind = "floor" | "cleared" | "water" | "lake";

/** Paints one tile of ground into a chunk's canvas. */
export function paintGround(
  ctx: Ctx,
  px: number,
  py: number,
  tx: number,
  ty: number,
  kind: GroundKind,
) {
  const r = groundRes;
  const base =
    kind === "floor"
      ? palette.floor
      : kind === "cleared"
        ? palette.meadow
        : kind === "lake"
          ? palette.lake
          : palette.water;
  rect(ctx, px, py, r, r, base);
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      const h = hash(tx * r + x, ty * r + y, 70);
      if (kind === "floor" && h < 0.12)
        rect(ctx, px + x, py + y, 1, 1, palette.floorSpeck);
      if (kind === "cleared") {
        if (h < 0.1) rect(ctx, px + x, py + y, 1, 1, palette.meadowLight);
        else if (h > 0.92) rect(ctx, px + x, py + y, 1, 1, palette.meadowDark);
      }
      if ((kind === "water" || kind === "lake") && h < 0.05 && x < r - 2)
        rect(ctx, px + x, py + y, 2, 1, palette.waterLight);
    }
  }
}

/** A stump on most felled tiles, at a varying spot, over the cleared ground. */
export function paintStump(
  ctx: Ctx,
  px: number,
  py: number,
  tx: number,
  ty: number,
) {
  if (hash(tx, ty, 80) < 0.35) return;
  const x = px + 1 + Math.floor(hash(tx, ty, 81) * (groundRes - 4));
  const y = py + 1 + Math.floor(hash(tx, ty, 82) * (groundRes - 4));
  rect(ctx, x, y, 3, 2, palette.stump);
  rect(ctx, x, y, 2, 1, palette.stumpTop);
}
