// Reads polylines and their attributes from an ESRI shapefile (.shp and .dbf),
// as BAFU publishes its stream orders.
import { readFile } from "node:fs/promises";

/** The parts of each record's polyline, as [east, north] points; null for none. */
export async function polylines(path) {
  const b = await readFile(path);
  const shapes = [];
  for (let o = 100; o < b.length;) {
    const length = b.readInt32BE(o + 4) * 2;
    o += 8;
    const type = b.readInt32LE(o);
    if (type === 0) shapes.push(null);
    else if ([3, 13, 23].includes(type)) {
      const parts = b.readInt32LE(o + 36);
      const count = b.readInt32LE(o + 40);
      const starts = [];
      for (let i = 0; i < parts; i++)
        starts.push(b.readInt32LE(o + 44 + i * 4));
      starts.push(count);
      const at = o + 44 + parts * 4;
      const lines = [];
      for (let k = 0; k < parts; k++) {
        const line = [];
        for (let i = starts[k]; i < starts[k + 1]; i++)
          line.push([
            b.readDoubleLE(at + i * 16),
            b.readDoubleLE(at + i * 16 + 8),
          ]);
        lines.push(line);
      }
      shapes.push(lines);
    } else throw new Error(`Shape type ${type}`);
    o += length;
  }
  return shapes;
}

/** The records of a .dbf file, with only the named fields. */
export async function records(path, fields) {
  const b = await readFile(path);
  const count = b.readUInt32LE(4);
  const headerLength = b.readUInt16LE(8);
  const recordLength = b.readUInt16LE(10);
  const columns = [];
  let offset = 1;
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    const name = b.toString("latin1", o, o + 11).replace(/\0.*$/, "");
    const size = b[o + 16];
    if (fields.includes(name)) columns.push({ name, offset, size });
    offset += size;
  }
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = headerLength + i * recordLength;
    const record = {};
    for (const c of columns)
      record[c.name] = b
        .toString("utf8", start + c.offset, start + c.offset + c.size)
        .trim();
    out[i] = record;
  }
  return out;
}
