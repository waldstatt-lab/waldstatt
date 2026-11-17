/**
 * Draws the game with PixiJS in an isometric view: the textured ground in
 * chunks of 16 × 16 tiles, the rivers as smooth blue strokes, the Sihlsee
 * once it is dammed, and trees, buildings and Waldleute sorted back to front.
 * Chunks are made as they come into view and destroyed far off screen. The
 * camera position is in tiles; zoom is screen pixels per world unit.
 */
import {
  AlphaFilter,
  Application,
  Container,
  FillPattern,
  Graphics,
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
import { diamond, fromIso, iso, TH, TW } from "./iso";
import type { Game, Placement } from "./sim";
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
/** World units across a river per tile of its width. */
const across = 28.6;

/** A ring of tile points as world points on the ground. */
function ringToIso(ring: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    const p = iso(ring[i], ring[i + 1]);
    out.push(p.x, p.y);
  }
  return out;
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
    g.poly(ringToIso(ring)).stroke({
      width: 14,
      color: 0x8c7a52,
      join: "round",
    });
  for (const ring of shores) g.poly(ringToIso(ring)).fill(water);
  for (const ring of shores)
    g.poly(ringToIso(ring)).stroke({
      width: 3,
      color: 0x2a6fb8,
      alpha: 0.8,
      join: "round",
    });
  for (const ring of islands) g.poly(ringToIso(ring)).fill(0x3d5a30);
}

type GroundKind = "meadow" | "floor" | "bank";

interface ChunkView {
  cx: number;
  cy: number;
  ground: Graphics;
  trees: Map<string, Sprite>;
  marks: Map<string, Sprite>;
  dirty: boolean;
}

interface BuildingView {
  container: Container;
  signature: string;
  bar?: Graphics;
}

interface Art {
  texture: Texture;
  ax: number;
  ay: number;
}

export class Renderer {
  private world = new Container({ isRenderGroup: true });
  private groundLayer = new Container();
  private riverLayer = new Graphics();
  private lakeLayer = new Graphics();
  private lake = new Graphics();
  private objects = new Container({ sortableChildren: true });
  private markLayer = new Container();
  private workerLayer = new Container({ sortableChildren: true });
  private overlay = new Container();
  private previewLayer = new Container();
  private lakePreview = new Graphics();
  private ghost = new Graphics();
  private ghostSprite = new Sprite();
  private saw = new Graphics();
  private cursor = new Graphics();
  private selection = new Graphics();

  private chunks = new Map<string, ChunkView>();
  private buildings = new Map<number, BuildingView>();
  private workerSprites = new Map<number, Sprite>();
  private trees: Texture[];
  private ribbon: Art;
  private workerTextures: Texture[];
  private art = new Map<string, Art>();
  private patterns: Record<GroundKind, FillPattern>;
  private time = 0;
  private lastCamera = "";
  private missing = true;

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
    const mark = ribbon();
    this.ribbon = {
      texture: Texture.from(mark.canvas),
      ax: mark.ax,
      ay: mark.ay,
    };
    const pattern = (kind: GroundKind) => {
      const texture = Texture.from(groundTexture(kind));
      texture.source.addressMode = "repeat";
      return new FillPattern(texture, "repeat");
    };
    this.patterns = {
      meadow: pattern("meadow"),
      floor: pattern("floor"),
      bank: pattern("bank"),
    };

    app.stage.eventMode = "none";
    app.stage.addChild(this.world);
    this.previewLayer.addChild(this.lakePreview);
    this.previewLayer.filters = [new AlphaFilter({ alpha: 0.55 })];
    this.previewLayer.visible = false;
    this.overlay.addChild(
      this.previewLayer,
      this.ghost,
      this.ghostSprite,
      this.saw,
      this.selection,
      this.cursor,
    );
    this.world.addChild(
      this.groundLayer,
      this.riverLayer,
      this.lakeLayer,
      this.lake,
      this.objects,
      this.markLayer,
      this.workerLayer,
      this.overlay,
    );
    this.ghostSprite.alpha = 0.7;
    for (const ring of waters.basin.rings)
      this.lakePreview.poly(ringToIso(ring)).fill(0x2f8de0);
    this.drawWaters();
    this.drawLake();
    for (const b of game.state.buildings) this.building(b);
  }

  get camera(): Camera {
    return this.game.state.camera;
  }

  // --- Camera ------------------------------------------------------------

  minZoom(): number {
    const { width, height } = this.app.screen;
    return Math.max(
      0.3,
      Math.sqrt((width * height) / (((TW * TH) / 2) * maxVisibleTiles)),
    );
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

  /** The world's offset and scale on screen, for the HTML layer. */
  transform(): { x: number; y: number; zoom: number } {
    return {
      x: this.world.position.x,
      y: this.world.position.y,
      zoom: this.world.scale.x,
    };
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    const c = iso(this.camera.x, this.camera.y);
    return fromIso(c.x + (sx - width / 2) / z, c.y + (sy - height / 2) / z);
  }

  pan(dx: number, dy: number) {
    const z = this.camera.zoom;
    const c = iso(this.camera.x, this.camera.y);
    const t = fromIso(c.x - dx / z, c.y - dy / z);
    this.camera.x = t.x;
    this.camera.y = t.y;
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

  private applyCamera() {
    const { width, height } = this.app.screen;
    if (!this.camera.zoom) this.camera.zoom = this.defaultZoom();
    this.camera.zoom = this.clampZoom(this.camera.zoom);
    const z = this.camera.zoom;
    const c = iso(this.camera.x, this.camera.y);
    this.world.scale.set(z);
    this.world.position.set(
      Math.round(width / 2 - c.x * z),
      Math.round(height / 2 - c.y * z),
    );
  }

  /** The screen in world units, with a margin. */
  private screenRect(margin: number) {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    const c = iso(this.camera.x, this.camera.y);
    const hw = width / 2 / z + margin;
    const hh = height / 2 / z + margin;
    return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh + reach };
  }

  // --- Frame ---------------------------------------------------------------

  frame(dt: number) {
    this.time += dt;
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
    this.updateWorkers();
    for (const b of this.game.state.buildings) {
      const view = this.buildings.get(b.id);
      if (view?.bar) this.drawBar(view.bar, b);
    }
  }

  private chunkBounds(cx: number, cy: number) {
    const x0 = cx * RCHUNK;
    const y0 = cy * RCHUNK;
    const x1 = x0 + RCHUNK;
    const y1 = y0 + RCHUNK;
    return {
      x0: iso(x0, y1).x,
      x1: iso(x1, y0).x,
      y0: iso(x0, y0).y - reach,
      y1: iso(x1, y1).y,
    };
  }

  private updateChunks() {
    const view = this.screenRect(TW);
    const keep = this.screenRect(TW * 12);
    const corners = [
      fromIso(view.x0, view.y0 - reach),
      fromIso(view.x1, view.y0 - reach),
      fromIso(view.x0, view.y1),
      fromIso(view.x1, view.y1),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const cx0 = Math.floor(Math.min(...xs) / RCHUNK);
    const cx1 = Math.floor(Math.max(...xs) / RCHUNK);
    const cy0 = Math.floor(Math.min(...ys) / RCHUNK);
    const cy1 = Math.floor(Math.max(...ys) / RCHUNK);
    const wanted: [number, number, number][] = [];
    const mid = { x: this.camera.x / RCHUNK, y: this.camera.y / RCHUNK };
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.chunks.has(key(cx, cy))) continue;
        const b = this.chunkBounds(cx, cy);
        if (b.x1 < view.x0 || b.x0 > view.x1) continue;
        if (b.y1 < view.y0 || b.y0 > view.y1) continue;
        wanted.push([cx, cy, Math.hypot(cx + 0.5 - mid.x, cy + 0.5 - mid.y)]);
      }
    }
    // A few chunks per frame, nearest first, so panning stays smooth.
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of wanted.slice(0, 4)) this.createChunk(cx, cy);
    this.missing = wanted.length > 4;
    for (const chunk of this.chunks.values()) {
      const b = this.chunkBounds(chunk.cx, chunk.cy);
      const far =
        b.x1 < keep.x0 || b.x0 > keep.x1 || b.y1 < keep.y0 || b.y0 > keep.y1;
      if (far) this.destroyChunk(chunk);
    }
  }

  private createChunk(cx: number, cy: number) {
    const chunk: ChunkView = {
      cx,
      cy,
      ground: new Graphics(),
      trees: new Map(),
      marks: new Map(),
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
    for (const sprite of chunk.trees.values()) sprite.destroy();
    for (const sprite of chunk.marks.values()) sprite.destroy();
    this.chunks.delete(key(chunk.cx, chunk.cy));
  }

  private chunkAt(x: number, y: number) {
    return this.chunks.get(key(Math.floor(x / RCHUNK), Math.floor(y / RCHUNK)));
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
        g.poly(diamond(x, y)).fill({
          fill: this.patterns[kind],
          color: this.tint(x, y),
        });
        if (!built && game.isFelled(x, y)) stumps.push([x, y]);
      }
    }
    for (const [x, y] of stumps) {
      if (hash(x, y, 80) < 0.3) continue;
      const c = iso(
        x + 0.3 + hash(x, y, 81) * 0.4,
        y + 0.3 + hash(x, y, 82) * 0.4,
      );
      g.ellipse(c.x + 3, c.y + 1, 8, 3).fill({ color: 0x1e2a14, alpha: 0.35 });
      g.rect(c.x - 5, c.y - 5, 10, 5).fill(0x6b4a2b);
      g.ellipse(c.x, c.y, 5, 2.4).fill(0x5a3c22);
      g.ellipse(c.x, c.y - 5, 5, 2.4).fill(0xc9a46c);
    }
  }

  /** Rivers, brooks and the natural lakes, drawn once from the data. */
  private drawWaters() {
    for (const line of lines) {
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < line.points.length; i += 2)
        points.push(iso(line.points[i], line.points[i + 1]));
      this.strokeRiver(
        this.riverLayer,
        points,
        line.wide ? halfWidth.river : halfWidth.brook,
      );
    }
    for (const lake of waters.lakes)
      drawLakeShape(this.lakeLayer, lake, 0x3586d4);
  }

  private strokeRiver(
    g: Graphics,
    points: { x: number; y: number }[],
    hw: number,
  ) {
    const width = hw * 2 * across * 1.4;
    const layers: [number, number, number][] = [
      [width + 14, 0x8c7a52, 1],
      [width + 4, 0x2a6fb8, 1],
      [width - 3, 0x3a8ee0, 1],
      [width * 0.4, 0x4fa3ec, 1],
      [1.5, 0xa8dcff, 0.6],
    ];
    for (const [w, color, alpha] of layers) {
      g.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: w, color, alpha, cap: "round", join: "round" });
    }
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
    const p = iso(x + 0.5 + jx, y + 0.5 + jy);
    const size = (0.68 + hash(x, y, 12) * 0.24) / RES;
    sprite.anchor.set(treeFrame.ax / treeFrame.w, treeFrame.ay / treeFrame.h);
    sprite.scale.set(hash(x, y, 13) < 0.5 ? -size : size, size);
    sprite.position.set(p.x, p.y);
    sprite.zIndex = x + y + 1 + jx + jy;
    this.objects.addChild(sprite);
    chunk.trees.set(key(x, y), sprite);
  }

  private addMark(chunk: ChunkView, x: number, y: number) {
    const p = iso(x + 0.5, y + 0.5, 34);
    const sprite = new Sprite(this.ribbon.texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / RES);
    sprite.position.set(p.x, p.y);
    this.markLayer.addChild(sprite);
    chunk.marks.set(key(x, y), sprite);
    const tree = chunk.trees.get(key(x, y));
    if (tree) tree.tint = 0xffc4b0;
  }

  /** A tree was felled, marked or unmarked. */
  tree(x: number, y: number) {
    const chunk = this.chunkAt(x, y);
    if (!chunk) return;
    const k = key(x, y);
    const tree = chunk.trees.get(k);
    if (tree && !this.game.isTree(x, y)) {
      tree.destroy();
      chunk.trees.delete(k);
      chunk.dirty = true;
    }
    const mark = chunk.marks.get(k);
    const marked = this.game.isMarked(x, y);
    if (mark && !marked) {
      mark.destroy();
      chunk.marks.delete(k);
      const sprite = chunk.trees.get(k);
      if (sprite) sprite.tint = 0xffffff;
    } else if (!mark && marked) {
      this.addMark(chunk, x, y);
    }
  }

  /** Redraws what the flood changed. */
  flooded() {
    this.drawLake();
    for (const chunk of this.chunks.values())
      for (const k of [...chunk.trees.keys()]) {
        const [x, y] = k.split(",").map(Number);
        this.tree(x, y);
      }
    for (const chunk of this.chunks.values()) chunk.dirty = true;
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

  private place(sprite: Sprite, art: Art) {
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
      existing.container.destroy({ children: true });
      this.buildings.delete(b.id);
    }
    this.repaintFootprint(b);
    if (removed) return;

    const container = new Container();
    const corner = iso(b.x, b.y);
    container.position.set(corner.x, corner.y);
    container.zIndex = b.x + b.w - 1 + (b.y + b.h - 1) + 1.5;
    const sprite = new Sprite();
    this.place(sprite, this.picture(b));
    container.addChild(sprite);
    const view: BuildingView = { container, signature };
    if (b.state === "drowned") {
      container.alpha = 0.32;
      sprite.tint = 0x7fb0e0;
    } else if (b.state === "site") {
      sprite.alpha = 0.4;
      container.addChild(this.scaffold(b));
      view.bar = new Graphics();
      container.addChild(view.bar);
      this.drawBar(view.bar, b);
    }
    this.objects.addChild(container);
    this.buildings.set(b.id, view);
  }

  private scaffold(b: Building): Graphics {
    const g = new Graphics();
    const height = 34;
    for (const [u, v] of [
      [0.1, 0.1],
      [b.w - 0.1, 0.1],
      [b.w - 0.1, b.h - 0.1],
      [0.1, b.h - 0.1],
    ]) {
      const a = iso(u, v);
      const t = iso(u, v, height);
      g.moveTo(a.x, a.y).lineTo(t.x, t.y);
    }
    const ring = diamond(0.1, 0.1, b.w - 0.2, b.h - 0.2);
    g.poly(ring.map((value, i) => (i % 2 ? value - height : value)));
    g.stroke({ width: 2, color: 0x8a5a32 });
    const pile = iso(b.w * 0.3, b.h * 0.7);
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
    const centre = iso(b.w / 2, b.h / 2, 60);
    const width = 48;
    const done = this.game.progress(b);
    bar.clear();
    bar.roundRect(centre.x - width / 2, centre.y, width, 7, 3).fill(0x2a1f14);
    bar
      .roundRect(
        centre.x - width / 2 + 1.5,
        centre.y + 1.5,
        (width - 3) * done,
        4,
        2,
      )
      .fill(0xe8c050);
  }

  /** Rebuilds every building picture, e.g. after the flood. */
  rebuildAll() {
    for (const view of this.buildings.values())
      view.container.destroy({ children: true });
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
      const p = iso(w.x, w.y);
      sprite.position.set(p.x, p.y);
      sprite.zIndex = w.x + w.y;
    }
    for (const [id, sprite] of this.workerSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.workerSprites.delete(id);
      }
    }
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
      this.ghost.poly(diamond(x, y)).fill({ color, alpha: 0.4 });
    });
    this.ghost
      .poly(diamond(spot.x, spot.y, spot.w, spot.h))
      .stroke({ width: 2, color: spot.ok ? 0xfff4c8 : 0xd8432f });
    this.place(this.ghostSprite, this.picture({ ...b, w: spot.w, h: spot.h }));
    const corner = iso(spot.x, spot.y);
    this.ghostSprite.position.set(corner.x, corner.y);
    this.ghostSprite.visible = spot.ok;
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
    this.saw.poly(diamond(x, y, w, h)).fill({ color: 0xd8432f, alpha: 0.2 });
    this.saw.poly(diamond(x, y, w, h)).stroke({ width: 2, color: 0xd8432f });
  }

  setCursor(tile: { x: number; y: number } | null) {
    this.cursor.clear();
    if (!tile) return;
    this.cursor
      .poly(diamond(tile.x, tile.y))
      .stroke({ width: 4, color: 0x1a120c })
      .poly(diamond(tile.x, tile.y))
      .stroke({ width: 2, color: 0xfff4c8 });
  }

  setSelected(b: Building | null) {
    this.selection.clear();
    if (!b) return;
    this.selection
      .poly(diamond(b.x, b.y, b.w, b.h))
      .stroke({ width: 2.5, color: 0xfff4c8 });
  }
}
