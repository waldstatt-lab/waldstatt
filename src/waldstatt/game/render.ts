/**
 * Draws the game with PixiJS: the ground and trees in chunks of 32 × 32
 * tiles, generated when they come into view and destroyed far off screen;
 * buildings, scrolls, marked trees and Waldleute; and the overlays for
 * placing buildings, sawing areas, the keyboard cursor and the flood
 * preview. The camera position is in tiles; zoom is screen pixels per world
 * unit (one art pixel).
 */
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from "pixi.js";
import {
  buildingCanvas,
  groundRes,
  markSprite,
  paintGround,
  paintStump,
  palette,
  parchmentTiles,
  scrollHead,
  treeAtlas,
  treeSize,
  workerAtlas,
  workerSize,
} from "./art";
import { balance, CHUNK, kinds, TILE } from "./config";
import type { Game, Placement } from "./sim";
import { key } from "./sim";
import type { Building, Camera } from "./state";
import type { Section } from "./texts";
import { stripRows } from "./texts";
import { hasBaseTree, lakeTiles, treeJitter, treeVariant } from "./world";

interface ChunkView {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: Texture;
  ground: Sprite;
  trees: Container;
  treeSprites: Map<number, Sprite>;
  marks: Container;
  markSprites: Map<number, Sprite>;
  dirtyGround: boolean;
}

interface BuildingView {
  container: Container;
  signature: string;
  bar?: Graphics;
}

const maxZoom = 5;
/** Trees on screen at most, which sets how far one can zoom out. */
const maxVisibleTiles = 24000;

export class Renderer {
  private world = new Container({ isRenderGroup: true });
  private groundLayer = new Container();
  private lakePreview = new Graphics();
  private buildingLayer = new Container();
  private treeLayer = new Container({ sortableChildren: true });
  private markLayer = new Container({ sortableChildren: true });
  private workerLayer = new Container();
  private overlay = new Container();
  private ghost = new Graphics();
  private ghostSprite = new Sprite();
  private saw = new Graphics();
  private cursor = new Graphics();
  private selection = new Graphics();

  private chunks = new Map<string, ChunkView>();
  private buildings = new Map<number, BuildingView>();
  private workerSprites = new Map<number, Sprite>();

  private treeTextures: Texture[];
  private markTexture: Texture;
  private workerTextures: Texture[];
  private parchment: Texture[];
  private buildingTextures = new Map<string, Texture>();
  private time = 0;

  constructor(
    private app: Application,
    private game: Game,
    private sections: (b: Building) => Section[],
    private still: () => boolean,
  ) {
    TextureSource.defaultOptions.scaleMode = "nearest";
    const trees = Texture.from(treeAtlas());
    this.treeTextures = [0, 1, 2, 3].map(
      (i) =>
        new Texture({
          source: trees.source,
          frame: new Rectangle(i * treeSize.w, 0, treeSize.w, treeSize.h),
        }),
    );
    this.markTexture = Texture.from(markSprite());
    const workers = Texture.from(workerAtlas());
    this.workerTextures = [0, 1, 2, 3, 4].map(
      (i) =>
        new Texture({
          source: workers.source,
          frame: new Rectangle(i * workerSize.w, 0, workerSize.w, workerSize.h),
        }),
    );
    const parchment = Texture.from(parchmentTiles());
    this.parchment = [0, 1, 2, 3].map(
      (i) =>
        new Texture({
          source: parchment.source,
          frame: new Rectangle(i * TILE, 0, TILE, TILE),
        }),
    );

    app.stage.eventMode = "none";
    app.stage.addChild(this.world);
    this.overlay.addChild(
      this.lakePreview,
      this.ghostSprite,
      this.ghost,
      this.saw,
      this.selection,
      this.cursor,
    );
    this.world.addChild(
      this.groundLayer,
      this.buildingLayer,
      this.treeLayer,
      this.markLayer,
      this.workerLayer,
      this.overlay,
    );
    this.ghostSprite.alpha = 0.7;
    this.lakePreview.visible = false;
    for (const [x, y] of lakeTiles())
      this.lakePreview.rect(x * TILE, y * TILE, TILE, TILE);
    this.lakePreview.fill({ color: 0x3b82c4, alpha: 0.5 });
    for (const b of game.state.buildings) this.building(b);
  }

  get camera(): Camera {
    return this.game.state.camera;
  }

  // --- Camera ------------------------------------------------------------

  minZoom(): number {
    const { width, height } = this.app.screen;
    return Math.max(
      0.6,
      Math.sqrt((width * height) / (TILE * TILE * maxVisibleTiles)),
    );
  }

  clampZoom(zoom: number): number {
    return Math.min(maxZoom, Math.max(this.minZoom(), zoom));
  }

  /** A comfortable zoom for the screen: about 16 tiles across the short side. */
  defaultZoom(): number {
    const { width, height } = this.app.screen;
    return this.clampZoom(
      Math.round((Math.min(width, height) / (16 * TILE)) * 2) / 2,
    );
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    return {
      x: this.camera.x + (sx - width / 2) / (z * TILE),
      y: this.camera.y + (sy - height / 2) / (z * TILE),
    };
  }

  tileToScreen(x: number, y: number): { x: number; y: number } {
    const { width, height } = this.app.screen;
    const z = this.camera.zoom;
    return {
      x: (x - this.camera.x) * z * TILE + width / 2,
      y: (y - this.camera.y) * z * TILE + height / 2,
    };
  }

  pan(dx: number, dy: number) {
    const z = this.camera.zoom * TILE;
    this.camera.x -= dx / z;
    this.camera.y -= dy / z;
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
    this.world.scale.set(z);
    this.world.position.set(
      Math.round(width / 2 - this.camera.x * TILE * z),
      Math.round(height / 2 - this.camera.y * TILE * z),
    );
  }

  /** The tiles on screen, with a margin. */
  private view(margin = 2) {
    const { width, height } = this.app.screen;
    const a = this.screenToTile(0, 0);
    const b = this.screenToTile(width, height);
    return {
      x0: Math.floor(a.x) - margin,
      y0: Math.floor(a.y) - margin,
      x1: Math.ceil(b.x) + margin,
      y1: Math.ceil(b.y) + margin + 2,
    };
  }

  // --- Frame ---------------------------------------------------------------

  frame(dt: number) {
    this.time += dt;
    this.applyCamera();
    this.updateChunks();
    this.updateWorkers();
    for (const b of this.game.state.buildings) {
      const view = this.buildings.get(b.id);
      if (view?.bar) this.drawBar(view.bar, b);
    }
  }

  private updateChunks() {
    const v = this.view();
    const cx0 = Math.floor(v.x0 / CHUNK);
    const cy0 = Math.floor(v.y0 / CHUNK);
    const cx1 = Math.floor(v.x1 / CHUNK);
    const cy1 = Math.floor(v.y1 / CHUNK);
    const wanted: [number, number, number][] = [];
    const mid = { x: (cx0 + cx1) / 2, y: (cy0 + cy1) / 2 };
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (!this.chunks.has(key(cx, cy)))
          wanted.push([cx, cy, Math.hypot(cx - mid.x, cy - mid.y)]);
    // Build a few chunks per frame, nearest first, so panning stays smooth.
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of wanted.slice(0, 3)) this.createChunk(cx, cy);
    for (const chunk of this.chunks.values()) {
      const inView =
        chunk.cx >= cx0 &&
        chunk.cx <= cx1 &&
        chunk.cy >= cy0 &&
        chunk.cy <= cy1;
      chunk.ground.visible = chunk.trees.visible = chunk.marks.visible = inView;
      if (inView && chunk.dirtyGround) {
        chunk.texture.source.update();
        chunk.dirtyGround = false;
      }
      const far =
        chunk.cx < cx0 - 2 ||
        chunk.cx > cx1 + 2 ||
        chunk.cy < cy0 - 2 ||
        chunk.cy > cy1 + 2;
      if (far) this.destroyChunk(chunk);
    }
  }

  private createChunk(cx: number, cy: number) {
    const size = CHUNK * groundRes;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const texture = Texture.from(canvas);
    const ground = new Sprite(texture);
    ground.position.set(cx * CHUNK * TILE, cy * CHUNK * TILE);
    ground.scale.set(TILE / groundRes);
    const trees = new Container();
    trees.zIndex = cy;
    const marks = new Container();
    marks.zIndex = cy;
    const chunk: ChunkView = {
      cx,
      cy,
      canvas,
      ctx,
      texture,
      ground,
      trees,
      treeSprites: new Map(),
      marks,
      markSprites: new Map(),
      dirtyGround: false,
    };
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx;
        const y = cy * CHUNK + ly;
        this.paintTile(chunk, x, y);
        if (this.game.isTree(x, y)) this.addTree(chunk, x, y);
        if (this.game.isMarked(x, y)) this.addMark(chunk, x, y);
      }
    }
    texture.source.update();
    this.groundLayer.addChild(ground);
    this.treeLayer.addChild(trees);
    this.markLayer.addChild(marks);
    this.chunks.set(key(cx, cy), chunk);
  }

  private destroyChunk(chunk: ChunkView) {
    chunk.ground.destroy();
    chunk.texture.destroy(true);
    chunk.trees.destroy({ children: true });
    chunk.marks.destroy({ children: true });
    this.chunks.delete(key(chunk.cx, chunk.cy));
  }

  private chunkFor(x: number, y: number) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const chunk = this.chunks.get(key(cx, cy));
    return { chunk, index: (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK) };
  }

  private paintTile(chunk: ChunkView, x: number, y: number) {
    const px = (x - chunk.cx * CHUNK) * groundRes;
    const py = (y - chunk.cy * CHUNK) * groundRes;
    const g = this.game;
    const built = g.buildingAt(x, y);
    if (g.isWater(x, y)) {
      const lake = g.state.flooded && g.isLake(x, y);
      paintGround(chunk.ctx, px, py, x, y, lake ? "lake" : "water");
    } else if (g.isTree(x, y)) {
      paintGround(chunk.ctx, px, py, x, y, "floor");
    } else if (built || g.isFelled(x, y) || !hasBaseTree(x, y)) {
      const gap = !built && !g.isFelled(x, y) && Math.hypot(x, y) > 4;
      paintGround(chunk.ctx, px, py, x, y, gap ? "floor" : "cleared");
      if (!built && g.isFelled(x, y)) paintStump(chunk.ctx, px, py, x, y);
    }
  }

  private addTree(chunk: ChunkView, x: number, y: number) {
    const local = (y - chunk.cy * CHUNK) * CHUNK + (x - chunk.cx * CHUNK);
    const sprite = new Sprite(this.treeTextures[treeVariant(x, y)]);
    const [jx, jy] = treeJitter(x, y);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x * TILE + TILE / 2 + jx, y * TILE + TILE - 1 + jy);
    // Children stay in row order, so trees further south overlap.
    sprite.zIndex = local;
    chunk.trees.addChild(sprite);
    chunk.treeSprites.set(local, sprite);
  }

  private addMark(chunk: ChunkView, x: number, y: number) {
    const local = (y - chunk.cy * CHUNK) * CHUNK + (x - chunk.cx * CHUNK);
    const [jx, jy] = treeJitter(x, y);
    const sprite = new Sprite(this.markTexture);
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(x * TILE + TILE / 2 + jx, y * TILE + TILE - 5 + jy);
    chunk.marks.addChild(sprite);
    chunk.markSprites.set(local, sprite);
  }

  /** A tree was felled, marked or unmarked. */
  tree(x: number, y: number) {
    const { chunk, index } = this.chunkFor(x, y);
    if (!chunk) return;
    const tree = chunk.treeSprites.get(index);
    if (tree && !this.game.isTree(x, y)) {
      tree.destroy();
      chunk.treeSprites.delete(index);
      this.paintTile(chunk, x, y);
      chunk.dirtyGround = true;
    }
    const mark = chunk.markSprites.get(index);
    const marked = this.game.isMarked(x, y);
    if (mark && !marked) {
      mark.destroy();
      chunk.markSprites.delete(index);
    } else if (!mark && marked) {
      this.addMark(chunk, x, y);
    }
  }

  /** Repaints the ground and trees of an area, e.g. after the flood. */
  repaint(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const { chunk } = this.chunkFor(x, y);
        if (!chunk) continue;
        this.paintTile(chunk, x, y);
        chunk.dirtyGround = true;
        this.tree(x, y);
      }
    }
  }

  // --- Buildings -------------------------------------------------------------

  private texture(b: Pick<Building, "kind" | "w" | "h" | "game">): Texture {
    const name = `${b.kind}:${b.game ?? ""}:${b.w}x${b.h}`;
    let texture = this.buildingTextures.get(name);
    if (!texture) {
      const canvas = kinds[b.kind].scroll
        ? scrollHead(b.w)
        : buildingCanvas(b.kind, b.w, b.h, b.game);
      texture = Texture.from(canvas);
      this.buildingTextures.set(name, texture);
    }
    return texture;
  }

  /** Adds, updates or removes a building's picture. */
  building(b: Building, removed = false) {
    const existing = this.buildings.get(b.id);
    const scroll = !!kinds[b.kind].scroll;
    const signature = `${b.state}:${b.w}x${b.h}:${scroll ? this.stripSignature(b) : ""}`;
    if (existing && !removed && existing.signature === signature) return;
    if (existing) {
      existing.container.destroy({ children: true });
      this.buildings.delete(b.id);
    }
    // The ground under a building is cleared, and stumps go.
    this.repaintFootprint(b);
    if (removed) return;

    const container = new Container();
    container.position.set(b.x * TILE, b.y * TILE);
    const sprite = new Sprite(this.texture(b));
    container.addChild(sprite);
    const view: BuildingView = { container, signature };
    if (b.state === "drowned") {
      container.alpha = 0.35;
      sprite.tint = 0x7fb0e0;
    } else if (b.state === "site") {
      sprite.alpha = 0.35;
      const scaffold = new Graphics();
      const rows = scroll ? balance.scrollHeadRows : b.h;
      scaffold
        .rect(1, 1, b.w * TILE - 2, rows * TILE - 2)
        .stroke({ width: 1, color: 0x8a5a32 });
      for (let x = 4; x < b.w * TILE - 2; x += 10)
        scaffold.rect(x, 1, 1, rows * TILE - 2).fill(0x8a5a32);
      container.addChild(scaffold);
      view.bar = new Graphics();
      container.addChild(view.bar);
      this.drawBar(view.bar, b);
    } else if (scroll) {
      this.drawStrips(container, b);
    }
    this.buildingLayer.addChild(container);
    this.buildings.set(b.id, view);
  }

  private repaintFootprint(b: Building) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const { chunk } = this.chunkFor(x, y);
        if (!chunk) continue;
        this.paintTile(chunk, x, y);
        chunk.dirtyGround = true;
      }
    }
  }

  private stripSignature(b: Building): string {
    let bits = "";
    for (let y = b.y + balance.scrollHeadRows; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++)
        bits += this.game.isTree(x, y) ? "1" : "0";
    return bits;
  }

  /** Revealed sections of a finished scroll, in order. */
  revealed(b: Building): boolean[] {
    const rows = stripRows(this.sections(b));
    let from = balance.scrollHeadRows;
    return rows.map((count) => {
      const clear =
        b.state === "done" && this.game.rowsClear(b, from, from + count);
      from += count;
      return clear;
    });
  }

  private drawStrips(container: Container, b: Building) {
    const sections = this.sections(b);
    const rows = stripRows(sections);
    const revealed = this.revealed(b);
    let row = balance.scrollHeadRows;
    sections.forEach((section, i) => {
      for (let r = row; r < row + rows[i] && r < b.h; r++) {
        for (let c = 0; c < b.w; c++) {
          if (this.game.isTree(b.x + c, b.y + r)) continue;
          const tile = new Sprite(this.parchment[(c + r * 3) % 4]);
          tile.position.set(c * TILE, r * TILE);
          container.addChild(tile);
        }
      }
      if (revealed[i]) {
        const heading = new Text({
          text: section.heading,
          style: {
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 9,
            fontWeight: "bold",
            fill: palette.ink,
            wordWrap: true,
            wordWrapWidth: b.w * TILE - 8,
          },
          resolution: 4,
        });
        heading.position.set(4, row * TILE + 2);
        // The plate grows with the heading, which may wrap.
        const height = Math.ceil(heading.height) + 2;
        const plate = new Graphics()
          .rect(2, row * TILE + 1, b.w * TILE - 4, height)
          .fill(palette.parchment)
          .rect(2, row * TILE + 1 + height, b.w * TILE - 4, 1)
          .fill(palette.ink);
        container.addChild(plate, heading);
      }
      row += rows[i];
    });
  }

  private drawBar(bar: Graphics, b: Building) {
    const width = Math.min(b.w * TILE - 4, 40);
    const x = (b.w * TILE - width) / 2;
    const done = this.game.progress(b);
    bar.clear();
    bar.rect(x, -6, width, 4).fill(0x2a1f14);
    bar.rect(x + 1, -5, Math.round((width - 2) * done), 2).fill(0xe8c050);
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
        sprite.anchor.set(0.5, 1);
        this.workerLayer.addChild(sprite);
        this.workerSprites.set(w.id, sprite);
      }
      let frame = 0;
      if (!still && w.phase === "walk")
        frame = 1 + (Math.floor(this.time * 7) % 2);
      if (!still && w.phase === "work")
        frame = 3 + (Math.floor(this.time * 4 + w.id) % 2);
      sprite.texture = this.workerTextures[frame];
      sprite.scale.x = w.facing;
      sprite.position.set(Math.round(w.x * TILE), Math.round(w.y * TILE));
      sprite.zIndex = w.y;
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
      const x = (spot.x + (i % spot.w)) * TILE;
      const y = (spot.y + Math.floor(i / spot.w)) * TILE;
      const color =
        tile === "blocked" ? 0xd8432f : tile === "tree" ? 0xe8c050 : 0x7ccf6a;
      this.ghost
        .rect(x + 1, y + 1, TILE - 2, TILE - 2)
        .fill({ color, alpha: 0.35 });
    });
    this.ghost
      .rect(spot.x * TILE, spot.y * TILE, spot.w * TILE, spot.h * TILE)
      .stroke({ width: 1, color: spot.ok ? 0xfff4c8 : 0xd8432f });
    this.ghostSprite.texture = this.texture({ ...b, w: spot.w, h: spot.h });
    this.ghostSprite.position.set(spot.x * TILE, spot.y * TILE);
    this.ghostSprite.visible = true;
  }

  setLakePreview(on: boolean) {
    this.lakePreview.visible = on;
  }

  setSaw(area: { x0: number; y0: number; x1: number; y1: number } | null) {
    this.saw.clear();
    if (!area) return;
    const x = Math.min(area.x0, area.x1) * TILE;
    const y = Math.min(area.y0, area.y1) * TILE;
    const w = (Math.abs(area.x1 - area.x0) + 1) * TILE;
    const h = (Math.abs(area.y1 - area.y0) + 1) * TILE;
    this.saw.rect(x, y, w, h).fill({ color: 0xd8432f, alpha: 0.18 });
    this.saw.rect(x, y, w, h).stroke({ width: 1, color: 0xd8432f });
  }

  setCursor(tile: { x: number; y: number } | null) {
    this.cursor.clear();
    if (!tile) return;
    this.cursor
      .rect(tile.x * TILE, tile.y * TILE, TILE, TILE)
      .stroke({ width: 1, color: 0xfff4c8 })
      .rect(tile.x * TILE - 1, tile.y * TILE - 1, TILE + 2, TILE + 2)
      .stroke({ width: 1, color: 0x1a120c });
  }

  setSelected(b: Building | null) {
    this.selection.clear();
    if (!b) return;
    this.selection
      .rect(b.x * TILE - 1, b.y * TILE - 1, b.w * TILE + 2, b.h * TILE + 2)
      .stroke({ width: 1, color: 0xfff4c8 });
  }
}
