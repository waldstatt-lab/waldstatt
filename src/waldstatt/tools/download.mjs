// Downloads the data for waters.mjs once and keeps it, unzipped, in
// node_modules/.cache/waldstatt-games-waters: swisstopo's GeoPackages and
// BAFU's stream orders. Unzipping needs `unzip`.
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const cache = path.resolve("node_modules/.cache/waldstatt-games-waters");

/**
 * The path of a file from a zip at `url`, downloaded and unzipped if it is
 * not in the cache yet. `file` is the file's name inside the zip.
 */
export async function unzipped(url, file) {
  const target = path.join(cache, file);
  if (existsSync(target)) return target;
  await mkdir(cache, { recursive: true });
  const zip = path.join(cache, path.basename(new URL(url).pathname));
  if (!existsSync(zip)) {
    console.log(`Downloading ${url} …`);
    const response = await fetch(url);
    if (!response.ok || !response.body)
      throw new Error(`${response.status} for ${url}`);
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(`${zip}.part`),
    );
    await rename(`${zip}.part`, zip);
  }
  console.log(`Unzipping ${path.basename(zip)} …`);
  const result = spawnSync(
    "unzip",
    ["-o", "-j", zip, `*${file}`, "-d", cache],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0 || !existsSync(target))
    throw new Error(`Could not unzip ${file} from ${zip}`);
  return target;
}
