// Generates ../game/waters.ts: the rivers and lakes around Einsiedeln from
// swisstopo VECTOR25 (river network GWN07) and BAFU (lakes), in game tiles.
//
//   node src/waldstatt/tools/waters.mjs
//
// Downloads are cached in node_modules/.cache/waldstatt-games-waters; delete
// the cache to refresh. Data: © swisstopo, © BAFU.
//
// One tile is 50 m; tile (0, 0) is the Klosterplatz Einsiedeln, north is −y.
// The Sihlsee is kept as the basin that the game's dam floods: before it, the
// Sihl and its brooks run through the valley along the lake axes the data
// records. Other reservoirs are left out; their rivers run through.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { features } from "./download.mjs";

const output = fileURLToPath(new URL("../game/waters.ts", import.meta.url));
const origin = [2699650, 1220350];
const metresPerTile = 50;
const area = { east: [2676000, 2718000], north: [1204000, 1242000] };
/** Rivers drawn wide and brooks drawn narrow, by name. */
const rivers = new Set([
  "Sihl",
  "Alp",
  "Biber",
  "Minster",
  "Lorze",
  "Wägitaler Aa",
  "Muota",
  "Steiner Aa",
  "Jona",
]);
const brooks = new Set(["Grossbach", "Eubach", "Steinbach", "Seeweren"]);
/** Natural lakes only; the Sihlsee is the basin. */
const basinName = "Sihlsee";

const toTile = ([e, n]) => [
  (e - origin[0]) / metresPerTile,
  (origin[1] - n) / metresPerTile,
];
const bounds = {
  x0: (area.east[0] - origin[0]) / metresPerTile,
  x1: (area.east[1] - origin[0]) / metresPerTile,
  y0: (origin[1] - area.north[1]) / metresPerTile,
  y1: (origin[1] - area.north[0]) / metresPerTile,
};

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d =
        Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring, simplified in two halves split at its farthest point. */
function simplifyRing(ring, tolerance) {
  const [x0, y0] = ring[0];
  let far = 0;
  ring.forEach(([x, y], i) => {
    if (
      Math.hypot(x - x0, y - y0) >
      Math.hypot(ring[far][0] - x0, ring[far][1] - y0)
    )
      far = i;
  });
  const first = simplify(ring.slice(0, far + 1), tolerance);
  const second = simplify([...ring.slice(far), ring[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}

const round = (points) =>
  points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
/** Points as a flat list, which keeps the generated file small. */
const flat = (points) => points.flat();

/** Clips a ring to the area, so far shores do not weigh on the page. */
function clip(ring) {
  const edges = [
    (p) => p[0] >= bounds.x0,
    (p) => p[0] <= bounds.x1,
    (p) => p[1] >= bounds.y0,
    (p) => p[1] <= bounds.y1,
  ];
  const cut = [
    (a, b) => [
      bounds.x0,
      a[1] + ((b[1] - a[1]) * (bounds.x0 - a[0])) / (b[0] - a[0]),
    ],
    (a, b) => [
      bounds.x1,
      a[1] + ((b[1] - a[1]) * (bounds.x1 - a[0])) / (b[0] - a[0]),
    ],
    (a, b) => [
      a[0] + ((b[0] - a[0]) * (bounds.y0 - a[1])) / (b[1] - a[1]),
      bounds.y0,
    ],
    (a, b) => [
      a[0] + ((b[0] - a[0]) * (bounds.y1 - a[1])) / (b[1] - a[1]),
      bounds.y1,
    ],
  ];
  let points = ring;
  edges.forEach((inside, k) => {
    const out = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      if (inside(p)) {
        out.push(p);
        if (!inside(q)) out.push(cut[k](p, q));
      } else if (inside(q)) {
        out.push(cut[k](p, q));
      }
    });
    points = out;
  });
  return points;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Joins segments that share end points into longer lines. */
function chain(lines) {
  const key = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const pool = lines.map((line) => [...line]);
  const result = [];
  while (pool.length) {
    let line = pool.pop();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const other = pool[i];
        if (key(line[line.length - 1]) === key(other[0]))
          line = [...line, ...other.slice(1)];
        else if (key(other[other.length - 1]) === key(line[0]))
          line = [...other, ...line.slice(1)];
        else if (key(line[line.length - 1]) === key(other[other.length - 1]))
          line = [...line, ...other.slice(0, -1).reverse()];
        else if (key(line[0]) === key(other[0]))
          line = [...other.slice(1).reverse(), ...line];
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    result.push(line);
  }
  return result;
}

const lakeData = await features("ch.bafu.vec25-seen", area, 42000);
const lakes = [];
let basin = null;
for (const f of lakeData) {
  const p = f.properties;
  const isBasin = p.name === basinName;
  if (p.seetyp === 2 && !isBasin) continue;
  const rings = [];
  for (const polygon of f.geometry.coordinates)
    for (const ring of polygon) {
      const tiles = clip(ring.map(toTile));
      if (tiles.length < 3) continue;
      const ringPoints = round(simplifyRing(tiles, 0.35));
      if (ringPoints.length >= 3) rings.push(ringPoints);
    }
  if (!rings.length) continue;
  const lake = { name: p.name, rings };
  if (isBasin) basin = lake;
  else lakes.push(lake);
}
// Lakes come in parts; merge the parts of one lake.
const merged = new Map();
for (const lake of lakes) {
  const existing = merged.get(lake.name);
  if (existing) existing.rings.push(...lake.rings);
  else merged.set(lake.name, lake);
}

const network = await features(
  "ch.swisstopo.vec25-gewaessernetz_referenz",
  area,
  3000,
);
const inBasin = (line) =>
  basin &&
  line.some(([x, y]) => basin.rings.some((ring) => inRing(x, y, ring)));
const byName = new Map();
for (const f of network) {
  const p = f.properties;
  const name = p.name.trim();
  if (!rivers.has(name) && !brooks.has(name)) continue;
  const kind = p.objectval;
  if (kind.endsWith("_U")) continue;
  for (const line of f.geometry.coordinates) {
    const tiles = line.map(toTile);
    // Lake axes only inside the Sihlsee: the valley before the dam.
    if (kind === "Seeachse" && !inBasin(tiles)) continue;
    if (!["Fluss", "Bach", "Bachachs", "Seeachse"].includes(kind)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(tiles);
  }
}
const lines = [];
for (const [name, parts] of byName) {
  for (const line of chain(parts)) {
    const points = round(simplify(line, 0.2));
    if (points.length < 2) continue;
    lines.push({ name, wide: rivers.has(name), points });
  }
}
lines.sort(
  (a, b) => a.name.localeCompare(b.name) || b.points.length - a.points.length,
);

// The dam: where the Sihl leaves the basin at its north end.
let dam = null;
if (basin) {
  let best = null;
  for (const line of lines.filter((l) => l.name === "Sihl")) {
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1];
      const b = line.points[i];
      const ia = basin.rings.some((r) => inRing(a[0], a[1], r));
      const ib = basin.rings.some((r) => inRing(b[0], b[1], r));
      if (ia === ib) continue;
      const crossing = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const along =
        Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]) ? "ns" : "ew";
      if (!best || crossing[1] < best.crossing[1]) best = { crossing, along };
    }
  }
  if (best) {
    const [cx, cy] = best.crossing;
    const [w, h] = best.along === "ns" ? [6, 2] : [2, 6];
    dam = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
  }
}

/** Points for name labels: lakes at a point inside, rivers along their course. */
const labels = [];
for (const lake of merged.values()) {
  const ring = lake.rings.reduce((a, b) => (b.length > a.length ? b : a));
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  let point = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  if (!inRing(point[0], point[1], ring))
    point = ring[Math.floor(ring.length / 2)];
  labels.push({ name: lake.name, x: point[0], y: point[1], lake: true });
}
if (basin) {
  const ring = basin.rings.reduce((a, b) => (b.length > a.length ? b : a));
  const ys = ring.map((p) => p[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const row = ring.filter((p) => Math.abs(p[1] - mid) < 6).map((p) => p[0]);
  labels.push({
    name: basinName,
    x: (Math.min(...row) + Math.max(...row)) / 2,
    y: mid,
    lake: true,
    basin: true,
  });
}
for (const name of byName.keys()) {
  const longest = lines
    .filter((l) => l.name === name)
    .reduce((a, b) => (b.points.length > a.points.length ? b : a));
  for (let i = 4; i < longest.points.length; i += 24) {
    const [x, y] = longest.points[i];
    if (basin?.rings.some((r) => inRing(x, y, r))) continue;
    labels.push({ name, x, y, lake: false });
  }
}

const source = `// Generated by tools/waters.mjs from swisstopo VECTOR25 (river network
// GWN07) and BAFU lake data; do not edit. © swisstopo, © BAFU.
// One tile is ${metresPerTile} m; tile (0, 0) is the Klosterplatz Einsiedeln
// (LV95 ${origin[0]} / ${origin[1]}); north is −y.

/** Points are flat lists: x0, y0, x1, y1, … */
export interface WaterLine { name: string; wide: boolean; points: number[] }
export interface Lake { name: string; rings: number[][] }
export interface WaterLabel { name: string; x: number; y: number; lake: boolean; basin?: boolean }

/** The area the data covers, in tiles. */
export const area = ${JSON.stringify(bounds)};
export const lines: WaterLine[] = ${JSON.stringify(lines.map((l) => ({ ...l, points: flat(l.points) })))};
export const lakes: Lake[] = ${JSON.stringify([...merged.values()].map((l) => ({ ...l, rings: l.rings.map(flat) })))};
/** The Sihlsee: the basin the dam floods. */
export const basin: Lake = ${JSON.stringify({ ...basin, rings: basin.rings.map(flat) })};
/** Where the Sihl leaves the basin: the dam's site. */
export const dam = ${JSON.stringify(dam)};
export const labels: WaterLabel[] = ${JSON.stringify(labels)};
`;
const options = (await prettier.resolveConfig(output)) ?? {};
const formatted = await prettier.format(source, {
  ...options,
  parser: "typescript",
});
await writeFile(output, formatted);
console.log(
  `${lines.length} lines (${lines.reduce((s, l) => s + l.points.length, 0)} points), ` +
    `${merged.size} lakes, basin ${basin ? basin.rings.length : 0} rings, dam ${JSON.stringify(dam)}, ` +
    `${labels.length} labels, ${(formatted.length / 1024).toFixed(0)} kB`,
);
