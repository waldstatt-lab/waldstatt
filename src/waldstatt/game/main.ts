/**
 * Starts the Waldstatt: reads the saved state, sets up PixiJS on the map,
 * wires the rules, the picture and the interface together, saves now and
 * then, and registers the service worker that makes the page installable and
 * playable offline (ADR 0002). Without WebGL the still picture and its note
 * stay.
 */
import { Application } from "pixi.js";
import { href } from "../../lib/url";
import { kinds, type Kind } from "./config";
import { attachInput } from "./input";
import { carGame } from "./previewCar";
import { motoGame } from "./previewMoto";
import { textLength, WorldLayer } from "./overlay";
import { mountPreview } from "./preview";
import { Renderer } from "./render";
import { Game, type Events } from "./sim";
import { clearSaved, load, save } from "./state";
import { readGames } from "./texts";
import { Ui } from "./ui";

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
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The rules exist before the picture and interface; their events wait.
  let renderer: Renderer | undefined;
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
      if (b.kind === "spielhaus") world?.refreshStage();
      ui?.building(b, !!removed);
      if (!ui || removed) return;
      if (b.state === "done" && !announced.has(b.id)) {
        // Only announce once, when the work completes.
        announced.add(b.id);
        ui.announce(
          kinds[b.kind].text
            ? `${kinds[b.kind].name} ist fertig. Der Text steht jetzt im Wald.`
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
    dirty: scheduleSave,
  };
  const scrollFor = (kind: Kind, game?: string) =>
    textLength(
      root,
      kind,
      games.find((g) => g.id === game),
    );
  const game = new Game(
    state,
    games.map((g) => g.id),
    scrollFor,
    events,
  );

  const app = new Application();
  // Shown before PixiJS measures it; the still forest stays on top until ready.
  host.hidden = false;
  try {
    await app.init({
      resizeTo: host,
      background: "#1c3420",
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
  world = new WorldLayer(
    host,
    game,
    games,
    root.querySelector<HTMLTemplateElement>("template[data-stage]"),
    (section, id) =>
      id === "moto-devil"
        ? mountPreview(section, motoGame)
        : id === "car-drive"
          ? mountPreview(section, carGame)
          : false,
    (b) => ui?.focus(b),
  );
  ui = new Ui({
    root,
    game,
    renderer,
    games,
    world,
    reset: () => {
      saving = false;
      window.clearTimeout(saveTimer);
      clearSaved();
      window.location.reload();
    },
    moved: scheduleSave,
  });
  attachInput(host, renderer, ui.handlers());

  for (const element of root.querySelectorAll<HTMLElement>("[data-ready-show]"))
    element.hidden = false;
  root
    .querySelector<HTMLElement>("[data-fallback]")
    ?.setAttribute("hidden", "");
  root.dataset.ready = "true";
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
