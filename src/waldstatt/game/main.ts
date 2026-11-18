/**
 * Starts the Waldstatt: reads the saved state, sets up PixiJS on the map,
 * wires the rules, the picture and the interface together, saves now and
 * then, and registers the service worker that makes the page installable and
 * playable offline (ADR 0002). Without WebGL the still picture and its note
 * stay.
 */
import { Application } from "pixi.js";
import { href } from "../../lib/url";
import { kinds, STAGE, textWidth } from "./config";
import { attachInput } from "./input";
import { textLength, WorldLayer } from "./overlay";
import { Renderer } from "./render";
import { Stage } from "./stage";
import { Game, type Events, type TextSpec } from "./sim";
import { clearSaved, load, save } from "./state";
import { readGames } from "./texts";
import { Ui } from "./ui";
import { loadPages, onPage, town } from "./world";

const root = document.querySelector<HTMLElement>("[data-wg]");
if (root) void start(root);

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function start(root: HTMLElement) {
  const note = root.querySelector<HTMLElement>("[data-fallback-note]");
  if (!hasWebGL()) {
    if (note) note.textContent = note.dataset.noWebgl ?? note.textContent;
    return;
  }
  const host = root.querySelector<HTMLElement>("[data-map]");
  if (!host) return;

  const games = readGames();
  const { state, problem } = load(new Set(games.map((g) => g.id)));
  // The water round Einsiedeln, where the texts lie hidden, and round the view.
  const reach = 130;
  const c = state.camera;
  await Promise.all([
    loadPages(town.x - reach, town.y - reach, town.x + reach, town.y + reach),
    loadPages(c.x - 40, c.y - 40, c.x + 40, c.y + 40),
  ]);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The rules exist before the picture and interface; their events wait.
  let renderer: Renderer | undefined;
  // The theatre's stage, while a finished theatre stands.
  let stage: Stage | null = null;
  let stageAt = { x: 0, y: 0 };
  const syncStage = () => {
    const theatre = game.state.buildings.find(
      (b) => b.kind === "theater" && b.state === "done",
    );
    if (!theatre) {
      if (stage) renderer?.setStage(null);
      stage = null;
      return;
    }
    const at = { x: theatre.x + STAGE.u0, y: theatre.y + STAGE.v0 };
    if (!stage || at.x !== stageAt.x || at.y !== stageAt.y) {
      stage = new Stage(
        STAGE.u1 - STAGE.u0,
        STAGE.v1 - STAGE.v0,
        () => games.filter((g) => game.done("spielhaus", g.id)),
        () => still.matches,
        (text) => ui?.announce(text),
      );
      stageAt = at;
      renderer?.setStage(stage, at.x, at.y);
    } else stage.refresh();
  };
  let world: WorldLayer | undefined;
  let ui: Ui | undefined;
  let saveTimer = 0;
  let saving = true;
  let warned = false;
  // Buildings finished before this visit are not news.
  const announced = new Set(
    state.buildings.filter((b) => b.state === "done").map((b) => b.id),
  );
  const scheduleSave = () => {
    if (!saving || saveTimer) return;
    saveTimer = window.setTimeout(saveNow, 2000);
  };
  const saveNow = () => {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (!saving) return;
    if (!save(state) && !warned) {
      warned = true;
      ui?.announce(
        "Der Browser lässt nicht speichern. Der Wald bleibt nur, bis du die Seite schliesst.",
      );
    }
  };
  const events: Events = {
    tree: (x, y) => renderer?.tree(x, y),
    building: (b, removed) => {
      renderer?.building(b, removed);
      world?.building(b, removed);
      if (b.kind === "theater" || b.kind === "spielhaus") syncStage();
      ui?.building(b, !!removed);
      if (!ui || removed) return;
      if (b.state === "done" && !announced.has(b.id)) {
        // Only announce once, when the work completes.
        announced.add(b.id);
        ui.announce(
          b.kind === "klause" || b.kind === "kloster"
            ? `${kinds[b.kind].name} ist fertig. Ein Rabe fliegt auf.`
            : `${kinds[b.kind].name} ist fertig.`,
        );
      }
    },
    supplies: () => ui?.supplies(),
    flooded: (drowned) => {
      renderer?.flooded();
      world?.flooded();
      ui?.announce(
        drowned.length
          ? `Der Damm steht, der Sihlsee entsteht. ${drowned.length === 1 ? "Ein Gebäude ging" : `${drowned.length} Gebäude gingen`} unter.`
          : "Der Damm steht, der Sihlsee entsteht.",
      );
    },
    hint: () => ui?.updateHint(),
    paving: (x, y) => {
      renderer?.paving(x, y);
      // A text on cobbles changes its ink.
      const t = game.textAt(x, y);
      if (t) world?.text(t);
    },
    text: (t, found) => {
      world?.text(t);
      renderer?.text(t);
      ui?.text(t, found);
    },
    items: () => {
      renderer?.items();
      ui?.items();
    },
    raven: (_r, t) => ui?.raven(t),
    dirty: scheduleSave,
  };
  // The texts hidden in the forest, as long as their text needs.
  const specs: TextSpec[] = [
    ...(["ortstafel", "chronik"] as const).map((kind) => ({
      key: kind,
      kind,
      w: textWidth(kind),
      h: textLength(root, kind, undefined),
    })),
    ...games.map((g) => ({
      key: `game:${g.id}`,
      kind: "game" as const,
      game: g.id,
      w: textWidth("game"),
      h: textLength(root, "game", g),
    })),
  ];
  const game = new Game(
    state,
    games.map((g) => g.id),
    specs,
    events,
  );
  // Pages arriving later bring new ways and work.
  onPage(() => game.pagesChanged());

  const app = new Application();
  // Shown before PixiJS measures it; the still forest stays on top until ready.
  host.hidden = false;
  try {
    await app.init({
      resizeTo: host,
      // Transparent, so the texts lying under the ground show through its
      // gaps (overlay.ts); the map's own background is the forest floor.
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
      powerPreference: "low-power",
    });
  } catch {
    host.hidden = true;
    if (note) note.textContent = note.dataset.noWebgl ?? note.textContent;
    return;
  }
  host.append(app.canvas);
  new ResizeObserver(() => app.resize()).observe(host);
  app.canvas.setAttribute("aria-hidden", "true");

  renderer = new Renderer(app, game, () => still.matches);
  world = new WorldLayer(host, game, games);
  ui = new Ui({
    root,
    game,
    renderer,
    games,
    world,
    stage: () => (stage ? { stage, x: stageAt.x, y: stageAt.y } : null),
    reset: () => {
      saving = false;
      window.clearTimeout(saveTimer);
      clearSaved();
      window.location.reload();
    },
    moved: scheduleSave,
  });
  syncStage();
  attachInput(host, renderer, ui.handlers());

  for (const element of root.querySelectorAll<HTMLElement>("[data-ready-show]"))
    element.hidden = false;
  root
    .querySelector<HTMLElement>("[data-fallback]")
    ?.setAttribute("hidden", "");
  root.dataset.ready = "true";
  if (problem === "old")
    ui.announce(
      "Die Waldleute sind nach Holzrüti gezogen. Ein neuer Wald wächst, und die Schriften liegen darin verborgen.",
    );
  if (problem === "invalid")
    ui.announce("Der gespeicherte Wald war beschädigt. Ein neuer Wald wächst.");
  if (problem === "storage")
    ui.announce(
      "Der Browser lässt nicht speichern. Der Wald bleibt nur, bis du die Seite schliesst.",
    );

  game.checkHint();
  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    game.step(dt, still.matches);
    renderer?.frame(dt);
    if (stage && renderer) {
      const area = { w: STAGE.u1 - STAGE.u0, h: STAGE.v1 - STAGE.v0 };
      if (renderer.onScreen(stageAt.x, stageAt.y, area.w, area.h)) {
        stage.view(renderer.inPlan);
        stage.frame(dt);
        renderer.updateStage(stage);
      }
    }
    if (renderer && world)
      world.frame(renderer.transform(), app.screen.width, app.screen.height);
    ui?.frame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });
  window.addEventListener("pagehide", saveNow);

  registerWorker();
}

/** The service worker, scoped to the base path. */
function registerWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  const scope = href("/");
  const register = () => {
    navigator.serviceWorker
      .register(href("/sw.js"), { scope })
      .then(async (registration) => {
        // The first visit is not controlled yet: hand the worker the files
        // this page loaded, so the next start works offline.
        await navigator.serviceWorker.ready;
        const files = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(window.location.origin));
        registration.active?.postMessage({
          type: "cache",
          files: [...files, window.location.href],
        });
      })
      .catch(() => {
        // Without a worker the game still runs; only offline starts fail.
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
