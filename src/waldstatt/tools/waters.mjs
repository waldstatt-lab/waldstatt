// Generates the waters of Switzerland and its border for the Waldstatt, in game
// tiles, from swisstopo's swissTLM3D (rivers, lakes, dams) and
// swissBOUNDARIES3D (the border):
//
//   node src/waldstatt/tools/waters.mjs
//
// It writes ../game/waters.ts, the small index the page loads with the game,
// and ../data/water-pages.json, one page per 10 km square, which the endpoint
// src/pages/waters/[page].json.ts serves as separate files.
// The GeoPackages (about 5 GB zipped, 11 GB unzipped) are downloaded once into
// node_modules/.cache/waldstatt-games-waters; unzipping needs `unzip`.
// Data: © swisstopo.
//
// One tile is 50 m; tile (0, 0) is the Klosterplatz Einsiedeln, north is −y.
// Watercourses 7 km long or more are kept whole, from source to mouth, as the
// named rivers and brooks around Einsiedeln were before; shorter brooks are
// left out. Natural lakes are kept from 0.03 km²; reservoirs, found by the
// dams at their shores, are left out and their rivers run through along the
// lake axes, except the Sihlsee, which stays the basin that the game's dam
// floods.
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { geoPackage } from "./download.mjs";
import { geometry } from "./gpkg.mjs";

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
const indexFile = here("../game/waters.ts");
const pagesFile = here("../data/water-pages.json");

const origin = [2699650, 1220350];
const metresPerTile = 50;
/** Tiles per page side: 10 km. */
const PAGE = 200;
/** Watercourses kept, and those drawn wide rather than as brooks, by length. */
const minLength = 7_000;
const wideLength = 14_000;
const minLakeArea = 30_000;
const basinName = "Sihlsee";

const toTile = ([e, n]) => [
  (e - origin[0]) / metresPerTile,
  (origin[1] - n) / metresPerTile,
];

// --- Geometry helpers -------------------------------------------------------

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
const flat = (points) => points.flat();

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
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

function box(points) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Clips a ring to a rectangle (Sutherland–Hodgman). */
function clipRing(ring, r) {
  const edges = [
    [(p) => p[0] >= r.x0, (a, b) => cutX(a, b, r.x0)],
    [(p) => p[0] <= r.x1, (a, b) => cutX(a, b, r.x1)],
    [(p) => p[1] >= r.y0, (a, b) => cutY(a, b, r.y0)],
    [(p) => p[1] <= r.y1, (a, b) => cutY(a, b, r.y1)],
  ];
  let points = ring;
  for (const [inside, cut] of edges) {
    if (!points.length) break;
    const out = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      if (inside(p)) {
        out.push(p);
        if (!inside(q)) out.push(cut(p, q));
      } else if (inside(q)) out.push(cut(p, q));
    });
    points = out;
  }
  return points;
}
const cutX = (a, b, x) => [
  x,
  a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]),
];
const cutY = (a, b, y) => [
  a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]),
  y,
];

/** Clips a line to a rectangle; returns the runs inside (Liang–Barsky per segment). */
function clipLine(line, r) {
  const runs = [];
  let run = null;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    let visible = true;
    for (const [p, q] of [
      [-dx, ax - r.x0],
      [dx, r.x1 - ax],
      [-dy, ay - r.y0],
      [dy, r.y1 - ay],
    ]) {
      if (p === 0) {
        if (q < 0) visible = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!visible || t0 > t1) {
      if (run) runs.push(run);
      run = null;
      continue;
    }
    const a = [ax + dx * t0, ay + dy * t0];
    const b = [ax + dx * t1, ay + dy * t1];
    if (!run) run = [a];
    run.push(b);
    if (t1 < 1) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

// --- Sources ------------------------------------------------------------------

const tlm = new DatabaseSync(
  await geoPackage(
    "https://data.geo.admin.ch/ch.swisstopo.swisstlm3d/swisstlm3d_2026-02/swisstlm3d_2026-02_2056_5728.gpkg.zip",
    "SWISSTLM3D_2026_LV95_LN02.gpkg",
  ),
  { readOnly: true },
);
const boundaries = new DatabaseSync(
  await geoPackage(
    "https://data.geo.admin.ch/ch.swisstopo.swissboundaries3d/swissboundaries3d_2026-01/swissboundaries3d_2026-01_2056_5728.gpkg.zip",
    "swissBOUNDARIES3D_1_5_LV95_LN02.gpkg",
  ),
  { readOnly: true },
);
/** The local name, the first of a multilingual one. */
const local = (name) => (name ?? "").split("|")[0].trim();

// --- The border -----------------------------------------------------------------

console.log("Border …");
const country = boundaries
  .prepare("select geom from tlm_landesgebiet where icc = 'CH'")
  .all()
  .flatMap((row) => geometry(row.geom).polygons);
/** Switzerland's rings in tiles: outer rings and holes (Büsingen, Campione). */
const land = country.flatMap((rings) =>
  rings.map((ring) => round(simplifyRing(ring.map(toTile), 0.5))),
);
const landBox = box(land.flat());
const insideLand = (x, y) =>
  land.filter((r) => inRing(x, y, r)).length % 2 === 1;

// --- Lakes ------------------------------------------------------------------------

console.log("Lakes …");
const dams = tlm
  .prepare(
    "select geom from tlm_bauten_staubaute where objektart in ('Staudamm', 'Staumauer')",
  )
  .all()
  .flatMap((row) => geometry(row.geom).polygons.map((rings) => rings[0]));
const damBoxes = dams.map((points) => box(points));
// Shore lines carry the names: a lake area takes the name whose shores
// cover the same box.
const shoreBoxes = new Map();
for (const row of tlm
  .prepare(
    "select name, gewiss_nr, geom from tlm_gewaesser_stehendes_gewaesser where objektart = 'See' and name is not null",
  )
  .iterate()) {
  const key = `${row.gewiss_nr}|${local(row.name)}`;
  const b = box(geometry(row.geom).lines[0]);
  const known = shoreBoxes.get(key);
  shoreBoxes.set(
    key,
    known
      ? {
          x0: Math.min(known.x0, b.x0),
          y0: Math.min(known.y0, b.y0),
          x1: Math.max(known.x1, b.x1),
          y1: Math.max(known.y1, b.y1),
        }
      : b,
  );
}
const shoreList = [...shoreBoxes].map(([key, b]) => ({
  name: key.split("|")[1],
  b,
}));
function lakeName(outer) {
  const b = box(outer);
  let best = "";
  let bestFit = 0.6;
  for (const { name, b: s } of shoreList) {
    const w = Math.min(b.x1, s.x1) - Math.max(b.x0, s.x0);
    const h = Math.min(b.y1, s.y1) - Math.max(b.y0, s.y0);
    if (w <= 0 || h <= 0) continue;
    const both = w * h;
    const fit =
      both /
      ((b.x1 - b.x0) * (b.y1 - b.y0) + (s.x1 - s.x0) * (s.y1 - s.y0) - both);
    if (fit > bestFit) {
      bestFit = fit;
      best = name;
    }
  }
  return best;
}
const lakes = [];
/** Reservoirs left out, whose rivers run through along the lake axes. */
const reservoirs = [];
let basin = null;
for (const row of tlm
  .prepare(
    "select geom from tlm_bb_bodenbedeckung where objektart = 'Stehende Gewaesser'",
  )
  .iterate()) {
  for (const rings of geometry(row.geom).polygons) {
    const area =
      ringArea(rings[0]) - rings.slice(1).reduce((s, r) => s + ringArea(r), 0);
    if (area < minLakeArea) continue;
    const name = lakeName(rings[0]);
    // A reservoir has a dam at its shore, within 100 m.
    const b = box(rings[0]);
    const dammed = dams.some((points, i) => {
      const d = damBoxes[i];
      if (
        d.x1 < b.x0 - 100 ||
        d.x0 > b.x1 + 100 ||
        d.y1 < b.y0 - 100 ||
        d.y0 > b.y1 + 100
      )
        return false;
      return points.some(([de, dn]) =>
        rings[0].some(
          ([e, n]) => Math.abs(e - de) < 100 && Math.abs(n - dn) < 100,
        ),
      );
    });
    const tiles = rings.map((ring) =>
      round(simplifyRing(ring.map(toTile), 0.35)),
    );
    if (tiles[0].length < 3) continue;
    const lake = {
      name,
      area,
      outer: tiles[0],
      islands: tiles.slice(1).filter((r) => r.length >= 3),
    };
    if (name === basinName) basin = lake;
    else if (dammed) reservoirs.push({ ring: tiles[0], box: box(tiles[0]) });
    else lakes.push(lake);
  }
}
lakes.sort((a, b) => b.area - a.area);
lakes.forEach((lake, i) => (lake.id = i + 1));
console.log(
  `  ${lakes.length} natural lakes, ${reservoirs.length} reservoirs left out, basin ${basin ? "found" : "missing"}`,
);
const basinRings = basin ? [basin.outer, ...basin.islands] : [];
const inBasin = (x, y) =>
  basinRings.filter((r) => inRing(x, y, r)).length % 2 === 1;
/** Whether a point lies in a lake that is left out: a reservoir, or the basin. */
const inReservoir = (x, y) =>
  inBasin(x, y) ||
  reservoirs.some(
    (r) =>
      x >= r.box.x0 &&
      x <= r.box.x1 &&
      y >= r.box.y0 &&
      y <= r.box.y1 &&
      inRing(x, y, r.ring),
  );

// --- Rivers: whole watercourses from 7 km long ----------------------------------------

console.log("Rivers …");
const rows = () =>
  tlm
    .prepare(
      "select id, objektart, verlauf, name, gewiss_nr, geom from tlm_gewaesser_fliessgewaesser where objektart in ('Fliessgewaesser', 'Seeachse') and gewiss_nr is not null",
    )
    .iterate();
const lengths = new Map();
for (const row of rows()) {
  if (row.objektart !== "Fliessgewaesser") continue;
  const line = geometry(row.geom).lines[0];
  let length = 0;
  for (let i = 1; i < line.length; i++)
    length += Math.hypot(
      line[i][0] - line[i - 1][0],
      line[i][1] - line[i - 1][1],
    );
  lengths.set(row.gewiss_nr, (lengths.get(row.gewiss_nr) ?? 0) + length);
}
// Whole watercourses, culverts included so they stay unbroken, and the lake
// axes only where a reservoir is left out, so the river runs through its
// valley.
const pieces = [];
for (const row of rows()) {
  const length = lengths.get(row.gewiss_nr) ?? 0;
  if (length < minLength) continue;
  const line = geometry(row.geom).lines[0].map(toTile);
  if (row.objektart === "Seeachse") {
    const [mx, my] = line[Math.floor(line.length / 2)];
    if (!inReservoir(mx, my)) continue;
  }
  pieces.push({
    water: row.gewiss_nr,
    name: local(row.name),
    wide: length >= wideLength,
    line,
  });
}
// Joins the pieces of one watercourse end to end, whichever way each was
// drawn, wherever exactly two of them meet. Half a metre is close enough.
const pointKey = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
const atNode = new Map();
const endKeys = (p) => [
  `${p.water}@${pointKey(p.line[0])}`,
  `${p.water}@${pointKey(p.line[p.line.length - 1])}`,
];
for (const p of pieces)
  for (const k of endKeys(p)) atNode.set(k, [...(atNode.get(k) ?? []), p]);
const used = new Set();
const joined = [];
/** Walks on from a piece's end `k` while the watercourse simply goes on. */
function walk(points, k) {
  for (;;) {
    const others = atNode.get(k) ?? [];
    if (others.length !== 2) return;
    const p = others.find((o) => !used.has(o));
    if (!p) return;
    used.add(p);
    const [a, b] = endKeys(p);
    const line = a === k ? p.line : [...p.line].reverse();
    points.push(...line.slice(1));
    k = a === k ? b : a;
  }
}
// Chains start where a watercourse begins, ends or branches (side arms carry
// the same number); loops come last.
const starts = pieces.filter((p) =>
  endKeys(p).some((k) => (atNode.get(k) ?? []).length !== 2),
);
for (const head of [...starts, ...pieces]) {
  if (used.has(head)) continue;
  used.add(head);
  const [a, b] = endKeys(head);
  const forward = (atNode.get(a) ?? []).length !== 2;
  const points = forward ? [...head.line] : [...head.line].reverse();
  walk(points, forward ? b : a);
  joined.push({ name: head.name, wide: head.wide, points });
}
const rivers = joined
  .map((r) => ({ ...r, points: round(simplify(r.points, 0.25)) }))
  .filter((r) => r.points.length >= 2);
console.log(
  `  ${[...lengths.values()].filter((l) => l >= minLength).length} watercourses, ${rivers.length} lines, ${rivers.reduce((n, r) => n + r.points.length, 0)} points`,
);

// --- The dam's site: where the Sihl leaves the basin at its north end -------------------

let dam = null;
if (basin) {
  let best = null;
  for (const river of rivers.filter((r) => r.name === "Sihl")) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1];
      const b = river.points[i];
      if (inBasin(...a) === inBasin(...b)) continue;
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

// --- Labels ---------------------------------------------------------------------------

const labels = [];
for (const lake of lakes) {
  if (!lake.name || lake.area < 100_000) continue;
  const b = box(lake.outer);
  let point = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  if (!inRing(point[0], point[1], lake.outer))
    point = lake.outer[Math.floor(lake.outer.length / 2)];
  labels.push({ name: lake.name, x: point[0], y: point[1], lake: true });
}
const named = new Map();
for (const r of rivers)
  if (r.name) named.set(r.name, [...(named.get(r.name) ?? []), r]);
for (const [name, lines] of named) {
  // About every 8 km along the river, away from the basin.
  let walked = 0;
  for (const r of lines)
    for (let i = 1; i < r.points.length; i++) {
      const [ax, ay] = r.points[i - 1];
      const [bx, by] = r.points[i];
      walked += Math.hypot(bx - ax, by - ay);
      if (walked < 160) continue;
      walked = 0;
      if (!inBasin(bx, by)) labels.push({ name, x: bx, y: by, lake: false });
    }
}
let basinLabel = null;
if (basin) {
  const ys = basin.outer.map((p) => p[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const row = basin.outer
    .filter((p) => Math.abs(p[1] - mid) < 6)
    .map((p) => p[0]);
  basinLabel = {
    name: basinName,
    x: (Math.min(...row) + Math.max(...row)) / 2,
    y: mid,
  };
}

// --- Pages --------------------------------------------------------------------------------

console.log("Pages …");
const pages = {};
const inside = [];
const px0 = Math.floor(landBox.x0 / PAGE);
const px1 = Math.floor(landBox.x1 / PAGE);
const py0 = Math.floor(landBox.y0 / PAGE);
const py1 = Math.floor(landBox.y1 / PAGE);
const border = land;
const overlaps = (b, r) =>
  b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1;
const riverBoxes = rivers.map((r) => box(r.points));
const lakeBoxes = lakes.map((l) => box(l.outer));
const borderBoxes = border.map((r) => box(r));
for (let py = py0; py <= py1; py++) {
  for (let px = px0; px <= px1; px++) {
    const rect = {
      x0: px * PAGE,
      y0: py * PAGE,
      x1: (px + 1) * PAGE,
      y1: (py + 1) * PAGE,
    };
    // Lines reach two tiles past the page, so strokes meet at its edges.
    const wide = {
      x0: rect.x0 - 2,
      y0: rect.y0 - 2,
      x1: rect.x1 + 2,
      y1: rect.y1 + 2,
    };
    const borderRuns = border
      .filter((_, i) => overlaps(borderBoxes[i], wide))
      .flatMap((ring) => clipLine([...ring, ring[0]], wide));
    const crossed = borderRuns.length > 0;
    const centreInside = insideLand(rect.x0 + PAGE / 2, rect.y0 + PAGE / 2);
    if (!crossed && !centreInside) continue;
    const page = {
      lines: [],
      lakes: [],
      shores: [],
      border: [],
      land: null,
      labels: [],
    };
    rivers.forEach((r, i) => {
      if (!overlaps(riverBoxes[i], wide)) return;
      for (const run of clipLine(r.points, wide))
        page.lines.push({
          name: r.name,
          wide: r.wide,
          points: flat(round(run)),
        });
    });
    lakes.forEach((l, i) => {
      if (!overlaps(lakeBoxes[i], wide)) return;
      const rings = [clipRing(l.outer, wide)].filter((r) => r.length >= 3);
      if (!rings.length) return;
      const islands = l.islands
        .map((r) => clipRing(r, wide))
        .filter((r) => r.length >= 3);
      page.lakes.push({
        id: l.id,
        rings: rings.map((r) => flat(round(r))),
        islands: islands.map((r) => flat(round(r))),
      });
      for (const ring of [l.outer, ...l.islands])
        for (const run of clipLine([...ring, ring[0]], wide))
          page.shores.push(flat(round(run)));
    });
    page.border = borderRuns.map((run) => flat(round(run)));
    if (crossed)
      page.land = land
        .map((ring) => clipRing(ring, rect))
        .filter((r) => r.length >= 3)
        .map((r) => flat(round(r)));
    page.labels = labels.filter(
      (l) => l.x >= rect.x0 && l.x < rect.x1 && l.y >= rect.y0 && l.y < rect.y1,
    );
    const empty =
      !page.lines.length &&
      !page.lakes.length &&
      !crossed &&
      !page.labels.length;
    if (empty) inside.push(px, py);
    else pages[`${px},${py}`] = page;
  }
}

// --- Writing ------------------------------------------------------------------------------

const withData = Object.keys(pages).flatMap((k) => k.split(",").map(Number));
const index = `// Generated by tools/waters.mjs from swisstopo's swissTLM3D and
// swissBOUNDARIES3D; do not edit. © swisstopo.
// One tile is ${metresPerTile} m; tile (0, 0) is the Klosterplatz Einsiedeln
// (LV95 ${origin[0]} / ${origin[1]}); north is −y. The waters themselves are in
// pages of ${PAGE} × ${PAGE} tiles, served from /waters/<px>_<py>.json.

/** Points are flat lists: x0, y0, x1, y1, … */
export interface Lake { name: string; rings: number[][] }
export interface WaterLabel { name: string; x: number; y: number; lake: boolean }
export interface WaterPage {
  /** Rivers and brooks, reaching two tiles past the page. */
  lines: { name: string; wide: boolean; points: number[] }[];
  /** Natural lakes' water by lake number: outer rings and islands. */
  lakes: { id: number; rings: number[][]; islands: number[][] }[];
  /** The lakes' shores, as lines. */
  shores: number[][];
  /** The national border, as lines. */
  border: number[][];
  /** Switzerland's area in the page if the border crosses it; null if all of it is. */
  land: number[][] | null;
  labels: WaterLabel[];
}

/** Tiles per page side. */
export const PAGE = ${PAGE};
/** Pages with a file, and pages wholly in Switzerland without water; all others lie abroad. */
const withData: number[] = ${JSON.stringify(withData)};
const inside: number[] = ${JSON.stringify(inside)};
export const pageKinds = new Map<string, "data" | "inside">();
for (let i = 0; i < withData.length; i += 2)
  pageKinds.set(\`\${withData[i]},\${withData[i + 1]}\`, "data");
for (let i = 0; i < inside.length; i += 2)
  pageKinds.set(\`\${inside[i]},\${inside[i + 1]}\`, "inside");
/** The Sihlsee: the basin the dam floods. */
export const basin: Lake = ${JSON.stringify({ name: basinName, rings: basinRings.map(flat) })};
/** Where the Sihl leaves the basin: the dam's site. */
export const dam = ${JSON.stringify(dam)};
export const basinLabel: WaterLabel | null = ${JSON.stringify(basinLabel && { ...basinLabel, lake: true })};
`;
const options = (await prettier.resolveConfig(indexFile)) ?? {};
const formatted = await prettier.format(index, {
  ...options,
  parser: "typescript",
});
await writeFile(indexFile, formatted);
await mkdir(here("../data"), { recursive: true });
const json = JSON.stringify(pages);
await writeFile(pagesFile, json);
const { gzipSync } = await import("node:zlib");
const sizes = Object.values(pages).map(
  (p) => gzipSync(JSON.stringify(p)).length,
);
sizes.sort((a, b) => a - b);
console.log(
  `${Object.keys(pages).length} pages with data, ${inside.length / 2} without; ` +
    `${(json.length / 1024).toFixed(0)} kB, gzip ${(sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} kB in all, ` +
    `median ${(sizes[sizes.length >> 1] / 1024).toFixed(1)} kB, largest ${(sizes[sizes.length - 1] / 1024).toFixed(1)} kB; ` +
    `index ${(formatted.length / 1024).toFixed(0)} kB; dam ${JSON.stringify(dam)}`,
);
