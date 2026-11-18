// Reads geometries from GeoPackage blobs (WKB with an optional Z, as in
// swisstopo's GeoPackages) into arrays of [east, north] points.

/** The WKB inside a GeoPackage geometry blob. */
function wkb(blob) {
  const b = Buffer.from(blob);
  const envelope = [0, 32, 48, 48, 64][(b[3] >> 1) & 7];
  return { b, offset: 8 + envelope };
}

function reader(b, start) {
  let o = start;
  let le = true;
  const u32 = () => {
    const v = le ? b.readUInt32LE(o) : b.readUInt32BE(o);
    o += 4;
    return v;
  };
  const f64 = () => {
    const v = le ? b.readDoubleLE(o) : b.readDoubleBE(o);
    o += 8;
    return v;
  };
  const header = () => {
    le = b[o] === 1;
    o += 1;
    const type = u32();
    // ISO (1000s) and EWKB-style (high bit) Z flags.
    const z = type > 1000 || (type & 0x80000000) !== 0;
    return { type: (type & 0xffff) % 1000, dim: z ? 3 : 2 };
  };
  const points = (dim) => {
    const n = u32();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const e = f64();
      const north = f64();
      if (dim === 3) o += 8;
      out[i] = [e, north];
    }
    return out;
  };
  const geometry = () => {
    const { type, dim } = header();
    if (type === 2) return { kind: "line", lines: [points(dim)] };
    if (type === 3) {
      const rings = [];
      const n = u32();
      for (let i = 0; i < n; i++) rings.push(points(dim));
      return { kind: "polygon", polygons: [rings] };
    }
    if (type === 5 || type === 6) {
      const n = u32();
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(geometry());
      return type === 5
        ? { kind: "line", lines: parts.flatMap((p) => p.lines) }
        : { kind: "polygon", polygons: parts.flatMap((p) => p.polygons) };
    }
    throw new Error(`WKB type ${type}`);
  };
  return { geometry };
}

/** Lines of a (multi)line string, or polygons (lists of rings) of a (multi)polygon. */
export function geometry(blob) {
  const { b, offset } = wkb(blob);
  return reader(b, offset).geometry();
}

/** Only the first and last point of a line string, without reading the rest. */
export function ends(blob) {
  const { b, offset } = wkb(blob);
  const le = b[offset] === 1;
  const type = le ? b.readUInt32LE(offset + 1) : b.readUInt32BE(offset + 1);
  const dim = type > 1000 || (type & 0x80000000) !== 0 ? 3 : 2;
  if ((type & 0xffff) % 1000 !== 2) return null;
  const n = le ? b.readUInt32LE(offset + 5) : b.readUInt32BE(offset + 5);
  const at = (i) => {
    const o = offset + 9 + i * dim * 8;
    return le
      ? [b.readDoubleLE(o), b.readDoubleLE(o + 8)]
      : [b.readDoubleBE(o), b.readDoubleBE(o + 8)];
  };
  return [at(0), at(n - 1)];
}
