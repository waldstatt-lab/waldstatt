/**
 * Starts the Waldstatt: reads the saved state from IndexedDB (ADR 0003), sets
 * up PixiJS on the map, wires the rules, the picture and the interface
 * together, saves now and then, loads saved forests and files in place of
 * the forest being played (ADR 0004), and registers the service worker that
 * makes the page installable and playable offline (ADR 0002). Without WebGL
 * the still picture and its note stay.
 */
import { Application } from "pixi.js";
import { setIseLogo } from "./art";
import iseLogoUrl from "./ise-logo.png?url";
import { href } from "../../lib/url";
import { kinds, placing, STAGE, textWidth } from "./config";
import { attachInput } from "./input";
import { Commands, type Spec } from "./commands";
import { registerCommands } from "./commandSet";
import {
  load as loadKeys,
  onChange as keysChanged,
  scripts as savedScripts,
  lock,
  unlock,
  unlocked,
} from "./keymap";
import { ScriptError } from "./script/ast";
import type { Library } from "./script/check";
import type { Value } from "./script/compile";
import { Notices } from "./notices";
import { gameHost, gameQueries } from "./script/queries";
import { Runtime } from "./script/runtime";
import { ScriptsDialog } from "./scriptsDialog";
import { KeysDialog } from "./keysDialog";
import { textLength, WorldLayer } from "./overlay";
import { Renderer } from "./render";
import { Stage } from "./stage";
import { Game, type Events, type TextSpec } from "./sim";
import { SavesDialog } from "./savesDialog";
import { clearSaved, keep, load, replaceWith, save, whenClosed } from "./state";
import { readGames } from "./texts";
import { Ui } from "./ui";
import { loadPages, onPage, start as clearing, town } from "./world";

const root = document.querySelector<HTMLElement>("[data-wg]");
if (root)
  start(root).catch((error: unknown) => {
    // Say so instead of leaving the forest picture without a word.
    console.error(error);
    const note = root.querySelector<HTMLElement>("[data-fallback-note]");
    if (note)
      note.textContent = `Die Waldstatt konnte nicht starten: ${
        error instanceof Error ? error.message : String(error)
      }`;
  });

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
  const gameIds = new Set(games.map((g) => g.id));
  const { state, problem } = await load(gameIds);
  // The water as far out as the texts may lie hidden: the games' scrolls
  // round the first clearing, the town's texts round the Klosterplatz; and
  // round the view.
  const reach = placing.far.max + 80;
  const near = placing.town.max + 40;
  const c = state.camera;
  await Promise.all([
    loadPages(
      clearing.x - reach,
      clearing.y - reach,
      clearing.x + reach,
      clearing.y + reach,
    ),
    loadPages(town.x - near, town.y - near, town.x + near, town.y + near),
    loadPages(c.x - 40, c.y - 40, c.x + 40, c.y + 40),
  ]);
  // The ISE AG's logo, for its forge, before anything is painted.
  const logo = new Image();
  logo.src = iseLogoUrl;
  await logo
    .decode()
    .then(() => setIseLogo(logo))
    .catch(() => undefined);
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
  // The scripts' runs as data, once the runtime exists (ADR 0007).
  let scriptRuns = (): unknown => state.scripts;
  const saveNow = () => {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (!saving) return;
    state.scripts = scriptRuns();
    void save(state).then((ok) => {
      if (ok || warned) return;
      warned = true;
      ui?.announce(
        "Der Browser lässt nicht speichern. Der Wald bleibt nur, bis du die Seite schliesst.",
      );
    });
  };
  const events: Events = {
    tree: (x, y) => renderer?.tree(x, y),
    building: (b, removed) => {
      renderer?.building(b, removed);
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
    flood: () => {
      renderer?.flooded();
      world?.flooded();
    },
    tomb: () => renderer?.props(),
    goods: () => ui?.items(),
    unlocked: () => ui?.unlocked(),
    news: (text) => ui?.announce(text),
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
  game.titleOf = (id) => games.find((g) => g.id === id)?.title ?? id;

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

  renderer = new Renderer(
    app,
    game,
    () => still.matches,
    (id) => games.find((g) => g.id === id)?.title ?? "",
  );
  world = new WorldLayer(host, game, games);
  let saves: SavesDialog | undefined;
  let keys: KeysDialog | undefined;
  let scriptsDialog: ScriptsDialog | undefined;
  const commands = new Commands((text) => ui?.announce(text));
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
      void clearSaved().then(() => window.location.reload());
    },
    saves: () => void saves?.open(),
    keys: () => keys?.open(),
    scripts: () => scriptsDialog?.open(),
    commands,
    moved: scheduleSave,
  });
  const shown = ui;
  saves = new SavesDialog({
    root,
    state,
    gameIds,
    confirm: (o) => shown.confirm(o),
    announce: (text) => shown.announce(text),
    replace: async (next) => {
      // The forest being played is saved no more, so it cannot come back.
      saving = false;
      window.clearTimeout(saveTimer);
      if (await replaceWith(next)) window.location.reload();
      else
        shown.announce(
          "Der Wald liess sich nicht laden. Lade die Seite neu, um im bisherigen Wald weiterzuspielen; bis dahin wird hier nicht gespeichert.",
        );
    },
  });
  // Notices over the map (ADR 0008), from `notify:`, `say` and failures.
  const notices = new Notices(
    root.querySelector<HTMLElement>("[data-notices]") ?? root,
    {
      announce: (text) => shown.announce(text),
      openScript: (name) => scriptsDialog?.edit(name),
    },
  );
  // The player's scripts (ADR 0007): the game's queries, its commands, and
  // their runs, kept with the forest.
  const library: Library = {
    queries: gameQueries,
    command: (head) => commands.forScript(head),
  };
  const runtime = new Runtime({
    ...gameHost(game, {
      cursor: () => shown.cursorTile(),
      tool: () => shown.toolName(),
      name: (b) => game.nameOf(b),
    }),
    library,
    source: (name) => savedScripts()[name],
    names: () => Object.keys(savedScripts()),
    announce: (text) => shown.announce(text),
    command: (text) => commands.runScript(text),
    say: (text) =>
      notices.show({ kind: "info", text, script: runtime.stepping }),
    alert: (script, text) => notices.show({ kind: "alert", text, script }),
    unlocked: () => unlocked("scripts"),
  });
  // The `cmd:` of the scripts switched on here, as `$script:name(…)` for the
  // finder, keys and macros (ADR 0008); each starts a run at that command.
  commands.setExtra(() => {
    if (!unlocked("scripts")) return [];
    const out: Spec[] = [];
    for (const name of Object.keys(savedScripts())) {
      if (!runtime.enabled(name)) continue;
      const program = runtime.current(name);
      if (program instanceof ScriptError) continue;
      for (const [key, fn] of Object.entries(program.fns)) {
        if (fn.kind !== "cmd" || !key.startsWith(`${name}:`)) continue;
        const cmd = key.slice(name.length + 1);
        out.push({
          id: `$${key}`,
          args: fn.params.map((param) => ({ kind: "any", name: param })),
          describe: () =>
            program.docs[key] ?? `Befehl des Skripts «${name}» starten`,
          run: (args) =>
            runtime.startAt(
              name,
              cmd,
              args.map((a) => JSON.parse(a) as Value),
            ) ?? shown.announce(`«$${key}» läuft.`),
        });
      }
    }
    return out;
  });
  registerCommands(
    commands,
    shown,
    () => saves?.forestCommands(),
    () => ({
      unlocked: () => unlocked("scripts"),
      unlock: () => unlock("scripts"),
      lock: () => lock("scripts"),
      names: () => Object.keys(savedScripts()),
      enabled: (name) => runtime.enabled(name),
      enable: (name, on) => runtime.enable(name, on),
      disableAll: () => runtime.disableAll(),
      start: (name) => runtime.start(name),
      stop: (name) => runtime.stop(name),
      running: (name) => runtime.runs.some((r) => r.script === name),
      stopAll: () => runtime.stopAll(),
      open: () => scriptsDialog?.open(),
      edit: (name) => scriptsDialog?.edit(name),
    }),
    (kind, text) => notices.show({ kind, text, script: runtime.stepping }),
  );
  scriptsDialog = new ScriptsDialog({
    root,
    runtime,
    commands,
    library,
    confirm: (o) => shown.confirm(o),
    announce: (text) => shown.announce(text),
  });
  const dropped = runtime.load(state.scripts);
  if (dropped)
    shown.announce(
      dropped === 1
        ? "Ein Skript lief beim letzten Mal; es passt nicht mehr zu dieser Fassung des Spiels und ist beendet."
        : `${dropped} Skripte liefen beim letzten Mal; sie passen nicht mehr zu dieser Fassung des Spiels und sind beendet.`,
    );
  // A badge while scripts run, which opens the dialog; it and the menu's
  // «Skripte …» show only once scripts are unlocked.
  const badge = root.querySelector<HTMLButtonElement>("[data-scripts-badge]");
  const menuItem = root.querySelector<HTMLElement>("[data-scripts-item]");
  const showBadge = () => {
    const on = unlocked("scripts");
    if (menuItem) menuItem.hidden = !on;
    if (!badge) return;
    const n = on ? runtime.runs.length : 0;
    badge.hidden = !n;
    badge.textContent = n === 1 ? "▶ 1 Skript" : `▶ ${n} Skripte`;
  };
  badge?.addEventListener("click", () => scriptsDialog?.open());
  runtime.onChange(showBadge);
  keysChanged(showBadge);
  showBadge();
  scriptRuns = () => runtime.save();
  // Saved forests and files take the runs as they stand, every two seconds.
  window.setInterval(() => (state.scripts = runtime.save()), 2000);
  keys = new KeysDialog({
    root,
    commands,
    confirm: (o) => shown.confirm(o),
    announce: (text) => shown.announce(text),
  });
  // Every command a stored keymap names is checked against those registered;
  // a script's command (`$helfer:…`) only as written (ADR 0008).
  const why = (text: string) => commands.check(text);
  void loadKeys(why);
  syncStage();
  ui.useInput(attachInput(host, renderer, ui.handlers()));

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
  if (problem === "blocked") {
    // Another tab holds the saved forest; saving here could overwrite it.
    saving = false;
    ui.announce(
      "Ein anderer Tab der Waldstatt hält den gespeicherten Wald fest. Schliess ihn und lade diese Seite neu; bis dahin wird hier nicht gespeichert.",
    );
  }
  whenClosed(() => {
    saving = false;
    ui?.announce(
      "In einem anderen Tab wurde der Wald neu begonnen oder ein anderer geladen. Lade diese Seite neu; bis dahin wird hier nicht gespeichert.",
    );
  });

  if (window.matchMedia("(display-mode: standalone)").matches) keep();
  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    game.step(dt, still.matches);
    runtime.tick();
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

  // The Waldleute move and age all the time: save now and then anyway.
  window.setInterval(() => {
    if (!document.hidden) saveNow();
  }, 10_000);
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
