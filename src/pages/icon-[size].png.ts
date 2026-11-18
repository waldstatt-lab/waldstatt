/**
 * The app icons of the Waldstatt (ADR 0002): the fir from icons.ts, scaled
 * up without smoothing and encoded as PNG at build time.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { icons, pixel } from "../waldstatt/icons";
import { encodePng } from "../waldstatt/png";

export const getStaticPaths = (() =>
  [32, 180, 192, 512].map((size) => ({
    params: { size: String(size) },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const size = Number(params.size);
  const grid = icons.app.length;
  const png = await encodePng(size, (x, y) => {
    const gx = Math.floor((x * grid) / size);
    const gy = Math.floor((y * grid) / size);
    return pixel("app", gx, gy) ?? "#1c3420";
  });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
