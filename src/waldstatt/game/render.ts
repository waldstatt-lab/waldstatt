/**
 * Draws the game with PixiJS. Two layers share one camera:
 *
 * - the ground, drawn in tile units under the view's projection (iso.ts):
 *   textured tiles in chunks of 16 × 16, rivers, lakes, the Sihlsee once it
 *   is dammed, and the overlays for placing, sawing and the cursor;
 * - upright things, painted for the isometric view and positioned through
 *   the same projection: trees, buildings, ribbons and Waldleute, sorted back
 *   to front.
 *
 * The view is usually isometric. To read a text or play on the stage it turns
 * into a top-down plan with north up: while it turns, the upright pictures
 * blend into top-down ones (plan.ts) drawn on the ground. The
 * camera position is in tiles; zoom scales world units to screen pixels.
 */
import {
  AlphaFilter,
  Application,
  Container,
  FillPattern,
  Graphics,
  Matrix,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";
import {
  buildingPicture,
  groundTexture,
  hill,
  RES,
  ribbon,
  treeAtlas,
  treeFrame,
  workerAtlas,
  workerFrame,
} from "./art";
import { kinds } from "./config";
import {
  PLAN_RES,
  planPicture,
  planTreeAtlas,
  planTreeSize,
  planWorker,
} from "./plan";
import { apply, invert, iso, projection, TH, type Linear } from "./iso";
import type { Game, Placement } from "./sim";
import { STAGE_RES, type Stage } from "./stage";
import { key } from "./sim";
import type { Building, Camera } from "./state";
import { lines, type Lake } from "./waters";
import {
  halfWidth,
  hasBaseTree,
  hash,
  start,
  treeVariant,
  waters,
} from "./world";

/** Tiles per side of a render chunk. */
const RCHUNK = 16;
const maxZoom = 2.5;
/** Tiles on screen at most, which sets how far one can zoom out. */
const maxVisibleTiles = 16000;
/** How far trees and roofs reach above their tile, in world units. */
const reach = 200;
/** Seconds the view takes to turn. */
const turnSeconds = 0.7;

type GroundKind = "meadow" | "floor" | "bank";

/** Something upright at a place on the map. */
interface Upright {
  object: Container;
  x: number;
  y: number;
  /** Raised above the ground, in world units. */
  lift: number;
  /** Added to the sort order, to keep ribbons above their tree. */
  depth: number;
  /** Where it sorts, if not at (x, y): a building by its front tile. */
  sort?: { x: number; y: number };
}

interface ChunkView {
  cx: number;
  cy: number;
  ground: Graphics;
  trees: Map<string, Upright>;
  marks: Map<string, Upright>;
  /** The trees from above, made only while the view is not isometric. */
  planTrees: Map<string, Sprite> | null;
  dirty: boolean;
}

interface BuildingView {
  upright: Upright;
  plan: Container;
  signature: string;
  bar?: Graphics;
}

interface Art {
  texture: Texture;
  ax: number;
  ay: number;
}

function insideRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [
      ring[i * 2],
      ring[i * 2 + 1],
      ring[j * 2],
      ring[j * 2 + 1],
    ];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** A lake's shores, its water, and its islands drawn as land again. */
function drawLakeShape(g: Graphics, lake: Lake, water: number) {
  const islands = lake.rings.filter((ring) =>
    lake.rings.some(
      (other) => other !== ring && insideRing(ring[0], ring[1], other),
    ),
  );
  const shores = lake.rings.filter((ring) => !islands.includes(ring));
  for (const ring of shores)
    g.poly(ring).stroke({ width: 0.45, color: 0x8c7a52, join: "round" });
  for (const ring of shores) g.poly(ring).fill(water);
  for (const ring of shores)
    g.poly(ring).stroke({
      width: 0.1,
      color: 0x2a6fb8,
      alpha: 0.8,
      join: "round",
    });
  for (const ring of islands) g.poly(ring).fill(0x3d5a30);
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class Renderer {
  private ground = new Container({ isRenderGroup: true });
  private groundLayer = new Container();
  private riverLayer = new Graphics();
  private lakeLayer = new Graphics();
  private lake = new Graphics();
  private marksOnGround = new Container();
  /** Buildings, trees and Waldleute from above, for the plan view. */
  private planLayer = new Container();
  private planBuildings = new Container();
  private planTreeLayer = new Container();
  private planWorkerLayer = new Container();
  private planTrees: Texture[];
  private planWorkerTexture: Texture;
  private planWorkers = new Map<number, Sprite>();
  private planArt = new Map<string, Texture>();
  /** The theatre's stage, painted on the ground (stage.ts). */
  private stageLayer = new Container();
  private stageSprite: Sprite | null = null;
  private previewLayer = new Container();
  private lakePreview = new Graphics();
  private ghost = new Graphics();
  private saw = new Graphics();
  private cursor = new Graphics();
  private selection = new Graphics();

  private upright = new Container({ isRenderGroup: true });
  private objects = new Container({ sortableChildren: true });
  private markLayer = new Container();
  private workerLayer = new Container({ sortableChildren: true });
  private ghostSprite = new Sprite();
  private ghostAt: Upright = {
    object: this.ghostSprite,
    x: 0,
    y: 0,
    lift: 0,
    depth: 0,
  };

  private chunks = new Map<string, ChunkView>();
  private buildings = new Map<number, BuildingView>();
  private workerSprites = new Map<number, Sprite>();
  private trees: Texture[];
  private ribbonArt: Art;
  private workerTextures: Texture[];
  private art = new Map<string, Art>();
  private patterns: Record<GroundKind, FillPattern>;
  private time = 0;
  private lastCamera = "";
  private missing = true;

  /** The view: 0 isometric, 1 top-down plan. */
  private plan = 0;
  private L: Linear = projection(0);
  private flight: {
    from: { x: number; y: number; zoom: number; plan: number };
    to: { x: number; y: number; zoom: number; plan: number };
    t: number;
  } | null = null;

  constructor(
    private app: Application,
    private game: Game,
    private still: () => boolean,
  ) {
    TextureSource.defaultOptions.scaleMode = "linear";
    TextureSource.defaultOptions.autoGenerateMipmaps = true;
    const frames = (source: Texture, w: number, h: number, count: number) =>
      Array.from(
        { length: count },
        (_, i) =>
          new Texture({
            source: source.source,
            frame: new Rectangle(i * w * RES, 0, w * RES, h * RES),
          }),
      );
    this.trees = frames(Texture.from(treeAtlas()), treeFrame.w, treeFrame.h, 6);
    this.workerTextures = frames(
      Texture.from(workerAtlas()),
      workerFrame.w,
      workerFrame.h,
      5,
    );
    const crowns = Texture.from(planTreeAtlas()).source;
    this.planTrees = Array.from(
      { length: 6 },
      (_, i) =>
        new Texture({
          source: crowns,
          frame: new Rectangle(
            i * planTreeSize * PLAN_RES,
            0,
            planTreeSize * PLAN_RES,
            planTreeSize * PLAN_RES,
          ),
        }),
    );
    this.planWorkerTexture = Texture.from(planWorker());
    const mark = ribbon();
    this.ribbonArt = {
      texture: Texture.from(mark.canvas),
      ax: mark.ax,
      ay: mark.ay,
    };
    const pattern = (kind: GroundKind) => {
      const texture = Texture.from(groundTexture(kind));
      texture.source.addressMode = "repeat";
      const fill = new FillPattern(texture, "repeat");
      // 256 texture pixels span four tiles.
      fill.setTransform(new Matrix().scale(1 / 64, 1 / 64));
      return fill;
    };
    this.patterns = {
      meadow: pattern("meadow"),
      floor: pattern("floor"),
      bank: pattern("bank"),
    };

    app.stage.eventMode = "none";
    this.previewLayer.addChild(this.lakePreview);
    this.previewLayer.filters = [new AlphaFilter({ alpha: 0.55 })];
    this.previewLayer.visible = false;
    this.ground.addChild(
      this.groundLayer,
      this.riverLayer,
      this.lakeLayer,
      this.lake,
      this.planLayer,
      this.stageLayer,
      this.marksOnGround,
      this.previewLayer,
      this.ghost,
      this.saw,
      this.selection,
      this.cursor,
    );
    this.planLayer.addChild(
      this.planBuildings,
      this.planTreeLayer,
      this.planWorkerLayer,
    );
    this.planLayer.visible = false;
    this.ghostSprite.alpha = 0.7;
    this.ghostSprite.visible = false;
    this.upright.addChild(
      this.objects,
      this.markLayer,
      this.workerLayer,
      this.ghostSprite,
    );
    app.stage.addChild(this.ground, this.upright);
    for (const ring of waters.basin.rings)
      this.lakePreview.poly(ring).fill(0x2f8de0);
    this.drawWaters();
    this.drawLake();
    for (const b of game.state.buildings) this.building(b);
  }

  get camera(): Camera {
    return this.game.state.camera;
  }

  /** Whether the camera is still flying or the view turning. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** Whether the view is (turning towards) the top-down plan. */
  get inPlan(): boolean {
    return (this.flight?.to.plan ?? this.plan) > 0.5;
  }

  // --- Camera ------------------------------------------------------------

  minZoom(): number {
    const { width, height } = this.app.screen;
    const det = Math.abs(this.L.a * this.L.d - this.L.b * this.L.c);
    return Math.max(0.3, Math.sqrt((width * height) / (det * maxVisibleTiles)));
  }

  clampZoom(zoom: number): number {
    return Math.min(maxZoom, Math.max(this.minZoom(), zoom));
  }

  /** A comfortable zoom: about 24 tile rows across the shorter side. */
  defaultZoom(): number {
    const { width, height } = this.app.screen;
    return this.clampZoom(
      Math.round((Math.min(width, height) / (24 * TH)) * 4) / 4,
    );
  }

  private offset() {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    const c = apply(this.L, this.camera.x, this.camera.y);
    return { x: width / 2 - c.x * z, y: height / 2 - c.y * z, z };
  }

  /** The camera, for the HTML layer: offset, zoom, projection and how far turned. */
  transform(): {
    x: number;
    y: number;
    zoom: number;
    L: Linear;
    plan: number;
  } {
    const o = this.offset();
    return { x: o.x, y: o.y, zoom: o.z, L: this.L, plan: ease(this.plan) };
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const o = this.offset();
    return invert(this.L, (sx - o.x) / o.z, (sy - o.y) / o.z);
  }

  pan(dx: number, dy: number) {
    const z = this.camera.zoom;
    const d = invert(this.L, dx / z, dy / z);
    this.camera.x -= d.x;
    this.camera.y -= d.y;
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.screenToTile(sx, sy);
    this.camera.zoom = this.clampZoom(this.camera.zoom * factor);
    const after = this.screenToTile(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  centerOn(x: number, y: number) {
    this.camera.x = x;
    this.camera.y = y;
  }

  /**
   * Moves the camera, and turns the view to the plan (plan = 1) or back to
   * the isometric view (plan = 0), smoothly unless motion is reduced.
   */
  flyTo(to: { x: number; y: number; zoom: number; plan: number }) {
    const from = { ...this.camera, plan: this.plan };
    if (this.still()) {
      this.camera.x = to.x;
      this.camera.y = to.y;
      this.camera.zoom = to.zoom;
      this.setPlan(to.plan);
      return;
    }
    this.flight = { from, to, t: 0 };
  }

  private setPlan(plan: number) {
    this.plan = plan;
    this.L = projection(ease(plan));
    this.relayout();
    // The upright pictures blend into the ones from above.
    const e = ease(plan);
    this.upright.alpha = 1 - e;
    this.upright.visible = e < 0.999;
    this.planLayer.alpha = e;
    this.planLayer.visible = e > 0.001;
    if (e <= 0.001 && !this.flight) this.dropPlanTrees();
    this.lastCamera = "";
  }

  private applyCamera() {
    if (!this.camera.zoom) this.camera.zoom = this.defaultZoom();
    if (!this.flight) this.camera.zoom = this.clampZoom(this.camera.zoom);
    const o = this.offset();
    const L = this.L;
    this.ground.setFromMatrix(
      new Matrix(L.a * o.z, L.b * o.z, L.c * o.z, L.d * o.z, o.x, o.y),
    );
    this.upright.position.set(o.x, o.y);
    this.upright.scale.set(o.z);
  }

  /** The tiles whose things may be on screen. */
  private visibleTiles(margin: number) {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    const corners = [
      [-margin, -margin - reach * z],
      [width + margin, -margin - reach * z],
      [-margin, height + margin],
      [width + margin, height + margin],
    ].map(([sx, sy]) => this.screenToTile(sx, sy));
    return {
      x0: Math.min(...corners.map((c) => c.x)),
      x1: Math.max(...corners.map((c) => c.x)),
      y0: Math.min(...corners.map((c) => c.y)),
      y1: Math.max(...corners.map((c) => c.y)),
    };
  }

  // --- Frame ---------------------------------------------------------------

  frame(dt: number) {
    this.time += dt;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / turnSeconds);
      const k = ease(f.t);
      this.camera.x = f.from.x + (f.to.x - f.from.x) * k;
      this.camera.y = f.from.y + (f.to.y - f.from.y) * k;
      this.camera.zoom = f.from.zoom * (f.to.zoom / f.from.zoom) ** k;
      this.setPlan(f.from.plan + (f.to.plan - f.from.plan) * f.t);
      if (f.t >= 1) this.flight = null;
    }
    this.applyCamera();
    const { width, height } = this.app.screen;
    const camera = `${this.camera.x.toFixed(2)}:${this.camera.y.toFixed(2)}:${this.camera.zoom.toFixed(3)}:${width}x${height}`;
    if (camera !== this.lastCamera || this.missing) {
      this.lastCamera = camera;
      this.updateChunks();
    }
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) {
        chunk.dirty = false;
        this.drawGround(chunk);
      }
    }
    if (this.planLayer.visible)
      for (const chunk of this.chunks.values()) this.ensurePlanTrees(chunk);
    this.updateWorkers();
    for (const b of this.game.state.buildings) {
      const view = this.buildings.get(b.id);
      if (view?.bar) this.drawBar(view.bar, b);
    }
  }

  private updateChunks() {
    const view = this.visibleTiles(64);
    const keep = this.visibleTiles(1200);
    const wanted: [number, number, number][] = [];
    const mid = { x: this.camera.x / RCHUNK, y: this.camera.y / RCHUNK };
    for (
      let cy = Math.floor(view.y0 / RCHUNK);
      cy <= Math.floor(view.y1 / RCHUNK);
      cy++
    ) {
      for (
        let cx = Math.floor(view.x0 / RCHUNK);
        cx <= Math.floor(view.x1 / RCHUNK);
        cx++
      ) {
        if (this.chunks.has(key(cx, cy))) continue;
        if (!this.chunkOnScreen(cx, cy, 64)) continue;
        wanted.push([cx, cy, Math.hypot(cx + 0.5 - mid.x, cy + 0.5 - mid.y)]);
      }
    }
    // A few chunks per frame, nearest first, so panning stays smooth.
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of wanted.slice(0, 4)) this.createChunk(cx, cy);
    this.missing = wanted.length > 4;
    for (const chunk of this.chunks.values()) {
      const far =
        (chunk.cx + 1) * RCHUNK < keep.x0 ||
        chunk.cx * RCHUNK > keep.x1 ||
        (chunk.cy + 1) * RCHUNK < keep.y0 ||
        chunk.cy * RCHUNK > keep.y1;
      if (far) this.destroyChunk(chunk);
    }
  }

  /** Whether a chunk's ground or its trees may show on screen. */
  private chunkOnScreen(cx: number, cy: number, margin: number): boolean {
    const o = this.offset();
    const { width, height } = this.app.screen;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [
      [cx, cy],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx + 1, cy + 1],
    ]) {
      const p = apply(this.L, x * RCHUNK, y * RCHUNK);
      xs.push(o.x + p.x * o.z);
      ys.push(o.y + p.y * o.z);
    }
    return (
      Math.max(...xs) > -margin &&
      Math.min(...xs) < width + margin &&
      Math.max(...ys) > -margin &&
      Math.min(...ys) - reach * o.z < height + margin
    );
  }

  private createChunk(cx: number, cy: number) {
    const chunk: ChunkView = {
      cx,
      cy,
      ground: new Graphics(),
      trees: new Map(),
      marks: new Map(),
      planTrees: null,
      dirty: false,
    };
    this.drawGround(chunk);
    for (let y = cy * RCHUNK; y < (cy + 1) * RCHUNK; y++) {
      for (let x = cx * RCHUNK; x < (cx + 1) * RCHUNK; x++) {
        if (this.game.isTree(x, y)) this.addTree(chunk, x, y);
        if (this.game.isMarked(x, y)) this.addMark(chunk, x, y);
      }
    }
    this.groundLayer.addChild(chunk.ground);
    this.chunks.set(key(cx, cy), chunk);
  }

  private destroyChunk(chunk: ChunkView) {
    chunk.ground.destroy();
    for (const u of chunk.trees.values()) u.object.destroy();
    for (const u of chunk.marks.values()) u.object.destroy();
    if (chunk.planTrees)
      for (const sprite of chunk.planTrees.values()) sprite.destroy();
    this.chunks.delete(key(chunk.cx, chunk.cy));
  }

  private chunkAt(x: number, y: number) {
    return this.chunks.get(key(Math.floor(x / RCHUNK), Math.floor(y / RCHUNK)));
  }

  // --- Upright things --------------------------------------------------------

  /** Places an upright thing through the current projection. */
  private put(u: Upright) {
    const p = apply(this.L, u.x, u.y);
    u.object.position.set(p.x, p.y - u.lift);
    const s = u.sort ? apply(this.L, u.sort.x, u.sort.y) : p;
    u.object.zIndex = s.y + u.depth;
  }

  /** Repositions everything upright after the view turned. */
  private relayout() {
    for (const chunk of this.chunks.values()) {
      for (const u of chunk.trees.values()) this.put(u);
      for (const u of chunk.marks.values()) this.put(u);
    }
    for (const view of this.buildings.values()) this.put(view.upright);
    this.put(this.ghostAt);
  }

  /** A grey tint from the gentle hills, multiplied into the ground. */
  private tint(x: number, y: number): number {
    const v = Math.min(255, Math.round(255 * hill(x, y)));
    return (v << 16) | (v << 8) | v;
  }

  private drawGround(chunk: ChunkView) {
    const g = chunk.ground;
    const game = this.game;
    g.clear();
    const stumps: [number, number][] = [];
    for (let y = chunk.cy * RCHUNK; y < (chunk.cy + 1) * RCHUNK; y++) {
      for (let x = chunk.cx * RCHUNK; x < (chunk.cx + 1) * RCHUNK; x++) {
        if (game.state.flooded && game.isLake(x, y)) continue;
        const built = game.buildingAt(x, y);
        let kind: GroundKind = "floor";
        if (game.isWater(x, y)) kind = "bank";
        else if (built || game.isFelled(x, y)) kind = "meadow";
        else if (!hasBaseTree(x, y)) {
          const nearStart = Math.hypot(x - start.x, y - start.y) < 4;
          kind = nearStart ? "meadow" : "floor";
        }
        g.rect(x, y, 1, 1).fill({
          fill: this.patterns[kind],
          color: this.tint(x, y),
        });
        if (!built && game.isFelled(x, y)) stumps.push([x, y]);
      }
    }
    for (const [x, y] of stumps) {
      if (hash(x, y, 80) < 0.3) continue;
      const cx = x + 0.3 + hash(x, y, 81) * 0.4;
      const cy = y + 0.3 + hash(x, y, 82) * 0.4;
      g.circle(cx + 0.04, cy + 0.04, 0.12).fill({
        color: 0x1e2a14,
        alpha: 0.35,
      });
      g.circle(cx, cy, 0.1).fill(0x5a3c22);
      g.circle(cx, cy, 0.075).fill(0xc9a46c);
      g.circle(cx, cy, 0.035).stroke({ width: 0.012, color: 0x8a6a42 });
    }
  }

  /** Rivers, brooks and the natural lakes, drawn once from the data. */
  private drawWaters() {
    for (const line of lines) {
      const hw = (line.wide ? halfWidth.river : halfWidth.brook) * 1.4;
      const layers: [number, number, number][] = [
        [hw * 2 + 0.5, 0x8c7a52, 1],
        [hw * 2 + 0.14, 0x2a6fb8, 1],
        [hw * 2 - 0.1, 0x3a8ee0, 1],
        [hw * 0.8, 0x4fa3ec, 1],
        [0.05, 0xa8dcff, 0.6],
      ];
      for (const [width, color, alpha] of layers) {
        this.riverLayer.moveTo(line.points[0], line.points[1]);
        for (let i = 2; i < line.points.length; i += 2)
          this.riverLayer.lineTo(line.points[i], line.points[i + 1]);
        this.riverLayer.stroke({
          width,
          color,
          alpha,
          cap: "round",
          join: "round",
        });
      }
    }
    for (const lake of waters.lakes)
      drawLakeShape(this.lakeLayer, lake, 0x3586d4);
  }

  /** The Sihlsee, once the dam stands: water over the basin. */
  private drawLake() {
    this.lake.clear();
    if (this.game.state.flooded)
      drawLakeShape(this.lake, waters.basin, 0x3586d4);
  }

  private addTree(chunk: ChunkView, x: number, y: number) {
    const sprite = new Sprite(this.trees[treeVariant(x, y)]);
    const jx = (hash(x, y, 8) - 0.5) * 0.3;
    const jy = (hash(x, y, 9) - 0.5) * 0.3;
    const size = (0.68 + hash(x, y, 12) * 0.24) / RES;
    sprite.anchor.set(treeFrame.ax / treeFrame.w, treeFrame.ay / treeFrame.h);
    sprite.scale.set(hash(x, y, 13) < 0.5 ? -size : size, size);
    const u: Upright = {
      object: sprite,
      x: x + 0.5 + jx,
      y: y + 0.5 + jy,
      lift: 0,
      depth: 0,
    };
    this.put(u);
    this.objects.addChild(sprite);
    chunk.trees.set(key(x, y), u);
  }

  private addMark(chunk: ChunkView, x: number, y: number) {
    const sprite = new Sprite(this.ribbonArt.texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / RES);
    const u: Upright = {
      object: sprite,
      x: x + 0.5,
      y: y + 0.5,
      lift: 30,
      depth: 0,
    };
    this.put(u);
    this.markLayer.addChild(sprite);
    chunk.marks.set(key(x, y), u);
    const tree = chunk.trees.get(key(x, y))?.object;
    if (tree instanceof Sprite) tree.tint = 0xffc4b0;
  }

  /** The crowns of a chunk's trees from above, made when first needed. */
  private ensurePlanTrees(chunk: ChunkView) {
    if (chunk.planTrees) return;
    chunk.planTrees = new Map();
    for (const [k, u] of chunk.trees) {
      const [x, y] = k.split(",").map(Number);
      const sprite = new Sprite(this.planTrees[treeVariant(x, y)]);
      const size = 0.8 + hash(x, y, 12) * 0.3;
      sprite.anchor.set(0.5);
      sprite.scale.set(size / PLAN_RES);
      sprite.rotation = hash(x, y, 14) * Math.PI * 2;
      sprite.position.set(u.x, u.y);
      if (this.game.isMarked(x, y)) sprite.tint = 0xff9c88;
      this.planTreeLayer.addChild(sprite);
      chunk.planTrees.set(k, sprite);
    }
  }

  private dropPlanTrees() {
    for (const chunk of this.chunks.values()) {
      if (!chunk.planTrees) continue;
      for (const sprite of chunk.planTrees.values()) sprite.destroy();
      chunk.planTrees = null;
    }
  }

  /** A tree was felled, marked or unmarked. */
  tree(x: number, y: number) {
    const chunk = this.chunkAt(x, y);
    if (!chunk) return;
    const k = key(x, y);
    const tree = chunk.trees.get(k);
    if (tree && !this.game.isTree(x, y)) {
      tree.object.destroy();
      chunk.trees.delete(k);
      chunk.dirty = true;
      chunk.planTrees?.get(k)?.destroy();
      chunk.planTrees?.delete(k);
    }
    const crown = chunk.planTrees?.get(k);
    if (crown) crown.tint = this.game.isMarked(x, y) ? 0xff9c88 : 0xffffff;
    const mark = chunk.marks.get(k);
    const marked = this.game.isMarked(x, y);
    if (mark && !marked) {
      mark.object.destroy();
      chunk.marks.delete(k);
      const sprite = chunk.trees.get(k)?.object;
      if (sprite instanceof Sprite) sprite.tint = 0xffffff;
    } else if (!mark && marked) {
      this.addMark(chunk, x, y);
    }
  }

  /** Redraws what the flood changed. */
  flooded() {
    this.drawLake();
    for (const chunk of this.chunks.values()) {
      for (const k of [...chunk.trees.keys()]) {
        const [x, y] = k.split(",").map(Number);
        this.tree(x, y);
      }
      chunk.dirty = true;
    }
    this.rebuildAll();
  }

  // --- Buildings -------------------------------------------------------------

  private picture(b: Pick<Building, "kind" | "w" | "h" | "game">): Art {
    const name = `${b.kind}:${b.game ?? ""}:${b.w}x${b.h}`;
    let art = this.art.get(name);
    if (!art) {
      const picture = buildingPicture(b.kind, b.w, b.h, b.game);
      art = {
        texture: Texture.from(picture.canvas),
        ax: picture.ax,
        ay: picture.ay,
      };
      this.art.set(name, art);
    }
    return art;
  }

  private planTexture(b: Pick<Building, "kind" | "w" | "h" | "game">): Texture {
    const name = `${b.kind}:${b.game ?? ""}:${b.w}x${b.h}`;
    let texture = this.planArt.get(name);
    if (!texture) {
      texture = Texture.from(planPicture(b.kind, b.w, b.h, b.game));
      this.planArt.set(name, texture);
    }
    return texture;
  }

  private dress(sprite: Sprite, art: Art) {
    sprite.texture = art.texture;
    sprite.scale.set(1 / RES);
    sprite.anchor.set(
      (art.ax * RES) / art.texture.width,
      (art.ay * RES) / art.texture.height,
    );
  }

  /** Adds, updates or removes a building's picture. */
  building(b: Building, removed = false) {
    const existing = this.buildings.get(b.id);
    const signature = `${b.state}:${b.w}x${b.h}`;
    if (existing && !removed && existing.signature === signature) return;
    if (existing) {
      existing.upright.object.destroy({ children: true });
      existing.plan.destroy({ children: true });
      this.buildings.delete(b.id);
    }
    this.repaintFootprint(b);
    if (removed) return;

    const container = new Container();
    const sprite = new Sprite();
    this.dress(sprite, this.picture(b));
    container.addChild(sprite);
    // Sorted by its front tile, so trees further south still overlap it.
    const upright: Upright = {
      object: container,
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      lift: 0,
      depth: 0.1,
      sort: { x: b.x + b.w - 0.5, y: b.y + b.h - 0.5 },
    };
    const plan = new Container();
    plan.position.set(b.x, b.y);
    const top = new Sprite(this.planTexture(b));
    top.scale.set(1 / PLAN_RES);
    plan.addChild(top);
    this.planBuildings.addChild(plan);
    const view: BuildingView = { upright, plan, signature };
    if (b.state === "drowned") {
      container.alpha = 0.32;
      sprite.tint = 0x7fb0e0;
      plan.alpha = 0.32;
      top.tint = 0x7fb0e0;
    } else if (b.state === "site") {
      sprite.alpha = 0.4;
      top.alpha = 0.4;
      plan.addChild(
        new Graphics()
          .rect(0.1, 0.1, b.w - 0.2, b.h - 0.2)
          .stroke({ width: 0.1, color: 0x8a5a32 }),
      );
      container.addChild(this.scaffold(b));
      view.bar = new Graphics();
      container.addChild(view.bar);
      this.drawBar(view.bar, b);
    }
    this.put(upright);
    this.objects.addChild(container);
    this.buildings.set(b.id, view);
  }

  /** Scaffolding round a site, drawn for the isometric view. */
  private scaffold(b: Building): Graphics {
    const g = new Graphics();
    const height = 34;
    const at = (u: number, v: number, z = 0) =>
      iso(u - b.w / 2, v - b.h / 2, z);
    const corners = [
      [0.1, 0.1],
      [b.w - 0.1, 0.1],
      [b.w - 0.1, b.h - 0.1],
      [0.1, b.h - 0.1],
    ];
    for (const [u, v] of corners) {
      const a = at(u, v);
      const t = at(u, v, height);
      g.moveTo(a.x, a.y).lineTo(t.x, t.y);
    }
    g.poly(
      corners.flatMap(([u, v]) => {
        const p = at(u, v, height);
        return [p.x, p.y];
      }),
    );
    g.stroke({ width: 2, color: 0x8a5a32 });
    const pile = at(b.w * 0.3, b.h * 0.7);
    g.rect(pile.x - 10, pile.y - 6, 20, 6).fill(0xa8743f);
    g.rect(pile.x - 8, pile.y - 10, 16, 4).fill(0xb98a52);
    return g;
  }

  private repaintFootprint(b: Building) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const chunk = this.chunkAt(x, y);
        if (chunk) chunk.dirty = true;
      }
    }
  }

  private drawBar(bar: Graphics, b: Building) {
    const width = 48;
    const done = this.game.progress(b);
    const y = -70;
    bar.clear();
    bar.roundRect(-width / 2, y, width, 7, 3).fill(0x2a1f14);
    bar
      .roundRect(-width / 2 + 1.5, y + 1.5, (width - 3) * done, 4, 2)
      .fill(0xe8c050);
  }

  /** Rebuilds every building picture, e.g. after the flood. */
  rebuildAll() {
    for (const view of this.buildings.values()) {
      view.upright.object.destroy({ children: true });
      view.plan.destroy({ children: true });
    }
    this.buildings.clear();
    for (const b of this.game.state.buildings) this.building(b);
  }

  // --- Waldleute -------------------------------------------------------------

  private updateWorkers() {
    const still = this.still();
    const seen = new Set<number>();
    for (const w of this.game.workers) {
      seen.add(w.id);
      let sprite = this.workerSprites.get(w.id);
      if (!sprite) {
        sprite = new Sprite(this.workerTextures[0]);
        sprite.anchor.set(
          workerFrame.ax / workerFrame.w,
          workerFrame.ay / workerFrame.h,
        );
        this.workerLayer.addChild(sprite);
        this.workerSprites.set(w.id, sprite);
      }
      let frame = 0;
      if (!still && w.phase === "walk")
        frame = 1 + (Math.floor(this.time * 7) % 2);
      if (!still && w.phase === "work")
        frame = 3 + (Math.floor(this.time * 4 + w.id) % 2);
      sprite.texture = this.workerTextures[frame];
      sprite.scale.set(w.facing / RES, 1 / RES);
      const p = apply(this.L, w.x, w.y);
      sprite.position.set(p.x, p.y);
      sprite.zIndex = p.y;
    }
    for (const [id, sprite] of this.workerSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.workerSprites.delete(id);
      }
    }
    // The same Waldleute from above, while the plan shows.
    for (const w of this.game.workers) {
      let top = this.planWorkers.get(w.id);
      if (!top) {
        top = new Sprite(this.planWorkerTexture);
        top.anchor.set(0.5);
        top.scale.set(1 / PLAN_RES);
        this.planWorkerLayer.addChild(top);
        this.planWorkers.set(w.id, top);
      }
      top.position.set(w.x, w.y - 0.15);
      top.rotation = w.facing > 0 ? 0 : Math.PI;
    }
    for (const [id, top] of this.planWorkers) {
      if (!seen.has(id)) {
        top.destroy();
        this.planWorkers.delete(id);
      }
    }
  }

  // --- The stage -------------------------------------------------------------

  /** Lays the stage's picture on the ground at (x, y), or removes it. */
  setStage(stage: Stage | null, x = 0, y = 0) {
    if (this.stageSprite) {
      this.stageSprite.texture.destroy(true);
      this.stageSprite.destroy();
      this.stageSprite = null;
    }
    if (!stage) return;
    const sprite = new Sprite(Texture.from(stage.canvas));
    sprite.scale.set(1 / STAGE_RES);
    sprite.position.set(x, y);
    this.stageLayer.addChild(sprite);
    this.stageSprite = sprite;
  }

  /** Uploads the stage's picture when it changed. */
  updateStage(stage: Stage) {
    if (!this.stageSprite || !stage.dirty) return;
    this.stageSprite.texture.source.update();
    stage.dirty = false;
  }

  /** Whether a rectangle of tiles shows on screen. */
  onScreen(x: number, y: number, w: number, h: number): boolean {
    const o = this.offset();
    const { width, height } = this.app.screen;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [cx, cy] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]) {
      const p = apply(this.L, cx, cy);
      xs.push(o.x + p.x * o.z);
      ys.push(o.y + p.y * o.z);
    }
    return (
      Math.max(...xs) > 0 &&
      Math.min(...xs) < width &&
      Math.max(...ys) > 0 &&
      Math.min(...ys) < height
    );
  }

  // --- Overlays -------------------------------------------------------------

  setGhost(spot: Placement | null, b?: Pick<Building, "kind" | "game">) {
    this.ghost.clear();
    this.ghostSprite.visible = false;
    if (!spot || !b) return;
    spot.tiles.forEach((tile, i) => {
      const x = spot.x + (i % spot.w);
      const y = spot.y + Math.floor(i / spot.w);
      const color =
        tile === "blocked" ? 0xd8432f : tile === "tree" ? 0xe86a2f : 0x7ccf6a;
      this.ghost
        .rect(x + 0.04, y + 0.04, 0.92, 0.92)
        .fill({ color, alpha: 0.4 });
    });
    this.ghost
      .rect(spot.x, spot.y, spot.w, spot.h)
      .stroke({ width: 0.06, color: spot.ok ? 0xfff4c8 : 0xd8432f });
    if (!spot.ok || kinds[b.kind].fit) return;
    this.dress(this.ghostSprite, this.picture({ ...b, w: spot.w, h: spot.h }));
    this.ghostAt.x = spot.x + spot.w / 2;
    this.ghostAt.y = spot.y + spot.h / 2;
    this.put(this.ghostAt);
    this.ghostSprite.zIndex = 0;
    this.ghostSprite.visible = true;
  }

  setLakePreview(on: boolean) {
    this.previewLayer.visible = on;
  }

  setSaw(area: { x0: number; y0: number; x1: number; y1: number } | null) {
    this.saw.clear();
    if (!area) return;
    const x = Math.min(area.x0, area.x1);
    const y = Math.min(area.y0, area.y1);
    const w = Math.abs(area.x1 - area.x0) + 1;
    const h = Math.abs(area.y1 - area.y0) + 1;
    this.saw.rect(x, y, w, h).fill({ color: 0xd8432f, alpha: 0.2 });
    this.saw.rect(x, y, w, h).stroke({ width: 0.06, color: 0xd8432f });
  }

  setCursor(tile: { x: number; y: number } | null) {
    this.cursor.clear();
    if (!tile) return;
    this.cursor
      .rect(tile.x, tile.y, 1, 1)
      .stroke({ width: 0.12, color: 0x1a120c })
      .rect(tile.x, tile.y, 1, 1)
      .stroke({ width: 0.06, color: 0xfff4c8 });
  }

  /** Highlights a building, e.g. the one about to be torn down. */
  setSelected(b: Building | null, color = 0xfff4c8) {
    this.selection.clear();
    if (!b) return;
    this.selection.rect(b.x, b.y, b.w, b.h).fill({ color, alpha: 0.25 });
    this.selection.rect(b.x, b.y, b.w, b.h).stroke({ width: 0.08, color });
  }
}
