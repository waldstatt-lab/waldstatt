// Downloads swisstopo/BAFU water data around Einsiedeln for waters.mjs.
// Responses are cached in node_modules/.cache/waldstatt-games-waters.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const api = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
export const cache = path.resolve("node_modules/.cache/waldstatt-games-waters");

async function cached(name, url) {
  const file = path.join(cache, name);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    const data = await response.json();
    await mkdir(cache, { recursive: true });
    await writeFile(file, JSON.stringify(data));
    return data;
  }
}

function identify(layer, [e0, n0, e1, n1]) {
  const box = `${e0},${n0},${e1},${n1}`;
  const query = new URLSearchParams({
    layers: `all:${layer}`,
    geometry: box,
    geometryType: "esriGeometryEnvelope",
    mapExtent: box,
    imageDisplay: "1000,1000,96",
    tolerance: "0",
    returnGeometry: "true",
    geometryFormat: "geojson",
    sr: "2056",
    limit: "200",
  });
  return cached(`${layer}-${box}.json`, `${api}?${query}`);
}

/** All features of a layer in an area, split into tiles below the result cap. */
export async function features(layer, area, tile) {
  const found = new Map();
  const visit = async (box, size) => {
    const data = await identify(layer, box);
    const results = data.results ?? [];
    if (results.length >= 200 && size > 500) {
      const half = size / 2;
      for (const [de, dn] of [
        [0, 0],
        [half, 0],
        [0, half],
        [half, half],
      ])
        await visit(
          [box[0] + de, box[1] + dn, box[0] + de + half, box[1] + dn + half],
          half,
        );
      return;
    }
    for (const f of results) found.set(f.id ?? f.properties?.objectid, f);
  };
  for (let e = area.east[0]; e < area.east[1]; e += tile)
    for (let n = area.north[0]; n < area.north[1]; n += tile)
      await visit([e, n, e + tile, n + tile], tile);
  return [...found.values()];
}
