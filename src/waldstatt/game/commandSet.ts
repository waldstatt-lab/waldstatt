/**
 * Every command of the Waldstatt (ADR 0006, commands.ts): moving and viewing,
 * selecting and applying, the tools and menus, building and repairing, a
 * building's card, the text mode, the saved forests and the macros. Each
 * runs through the interface (ui.ts) as a tap or key would. Their default
 * keys are in keymap.ts.
 */
import { slug, type Choice, type Commands, type Spec } from "./commands";
import { macros, setMacro } from "./keymap";
import type { Work } from "./script/machine";
import type { Building } from "./state";
import type { TextAction } from "./textCursor";
import type { Ui } from "./ui";
import { points, wearLevel } from "./wear";

/** What the saved forests offer as commands (savesDialog.ts). */
export interface ForestCommands {
  /** The saved forests' names. */
  names(): string[];
  save(): void;
  download(): void;
  fromFile(): void;
  load(name: string): void;
  downloadSaved(name: string): void;
  delete(name: string): void;
}

/** What the scripts offer as commands (script/runtime.ts, scriptsDialog.ts). */
export interface ScriptCommands {
  /** Whether scripts are unlocked, and unlocking them; false if they were. */
  unlocked(): boolean;
  unlock(): boolean;
  names(): string[];
  /** Whether a script is switched on in this forest, and switching it. */
  enabled(name: string): boolean;
  enable(name: string, on: boolean): void;
  start(name: string): string | undefined;
  stop(name: string): boolean;
  stopAll(): number;
  open(): void;
  edit(name: string): void;
}

/** The work a command left for a script to await (ADR 0007). */
const work = (kind: string, list: string | Building[]): string | Work =>
  typeof list === "string" ? list : { kind, ids: list.map((b) => b.id) };

export function registerCommands(
  commands: Commands,
  ui: Ui,
  forests: () => ForestCommands | undefined,
  scripts: () => ScriptCommands | undefined,
) {
  const game = () => ui.o.game;
  /** The script commands hide and refuse until scripts are unlocked. */
  const locked = {
    hidden: () => !scripts()?.unlocked(),
    unavailable: () =>
      scripts()?.unlocked() ? undefined : "Skripte sind nicht freigeschaltet.",
  };
  const step = (n: number) => `${n === 1 ? "ein Feld" : `${n} Felder`}`;
  const move = (
    id: string,
    direction: [number, number],
    where: string,
  ): Spec => ({
    id,
    args: [{ kind: "number", name: "Felder", min: 1, max: 9999, fallback: 1 }],
    count: "number",
    hold: true,
    pan: direction,
    describe: ([n]) => `Auswahl ${step(Number(n))} ${where}`,
    run: ([n]) => ui.moveCursor(direction, Number(n)),
  });
  const tool = (
    id: string,
    name: string,
    which: Parameters<Ui["chooseTool"]>[0],
    why?: () => string | undefined,
  ): Spec => ({
    id,
    global: true,
    describe: () => `Werkzeug ${name} wählen`,
    unavailable: why,
    run: () => ui.chooseTool(which),
  });
  const choice = (name: string, choices: () => Choice[]) => ({
    kind: "choice" as const,
    name,
    choices,
  });
  const text = (
    id: string,
    action: TextAction,
    what: string,
    repeats = true,
  ): Spec => ({
    id,
    args: [
      {
        kind: "number",
        name: "Mal",
        min: 0,
        max: 9999,
        fallback: action === "textStart" || action === "textEnd" ? 0 : 1,
      },
    ],
    count: "number",
    repeats,
    describe: () => what,
    unavailable: () => (ui.textMode ? undefined : "Nur im Textmodus."),
    run: ([n]) => ui.textRun(action, Number(n)),
  });
  // A building to repair: the one chosen, its card's, or the cursor's.
  const worn = () =>
    game().state.buildings.filter(
      (b) => b.state === "done" && !game().unrepairable(b),
    );
  const forest = (
    id: string,
    what: string,
    run: (f: ForestCommands, name?: string) => void,
    named = false,
  ): Spec => ({
    id,
    interactive: true,
    args: named
      ? [
          choice("einen gespeicherten Wald", () =>
            (forests()?.names() ?? []).map((n) => ({
              value: slug(n),
              label: n,
            })),
          ),
        ]
      : [],
    describe: ([value]) => {
      const name = forests()
        ?.names()
        .find((n) => slug(n) === value);
      return name ? `${what}: «${name}»` : what;
    },
    run: ([value]) => {
      const f = forests();
      if (!f) return "Die gespeicherten Wälder sind noch nicht bereit.";
      const name = f.names().find((n) => slug(n) === value);
      run(f, name);
    },
  });

  commands.add(
    // --- Moving and viewing -----------------------------------------------------
    move("left", [-1, 0], "nach links"),
    move("right", [1, 0], "nach rechts"),
    move("up", [0, -1], "nach oben"),
    move("down", [0, 1], "nach unten"),
    {
      id: "zoom:in",
      count: "repeat",
      describe: () => "Näher heran",
      run: () => ui.zoom(1.25),
    },
    {
      id: "zoom:out",
      count: "repeat",
      describe: () => "Weiter weg",
      run: () => ui.zoom(0.8),
    },
    {
      id: "goto:start",
      describe: () => "Zur ersten Lichtung",
      run: () => ui.menuAction("home"),
    },
    {
      id: "goto",
      args: [choice("eine gefundene Schrift", () => ui.textChoices())],
      describe: ([value]) =>
        `Zur Schrift «${ui.textChoices().find((c) => c.value === value)?.label ?? value}»`,
      run: ([value]) => ui.readTextBySlug(value),
    },
    // --- Selecting and applying ----------------------------------------------------
    {
      id: "enter",
      describe: () =>
        "Wie die Eingabetaste: Werkzeug anwenden, Gebäude öffnen, bauen, Auswahl beginnen oder schliessen",
      run: () => ui.enter(),
    },
    {
      id: "selection:start",
      describe: () => "Auswahl an der Cursorstelle beginnen",
      run: () => ui.selectionStart(),
    },
    {
      id: "selection:other",
      describe: () => "Zur anderen Ecke der Auswahl springen",
      run: () => ui.selectionOther(),
    },
    {
      id: "selection:confirm",
      describe: () => "Auswahl an der Cursorstelle schliessen und anwenden",
      run: () => ui.selectionConfirm(),
    },
    {
      id: "selection:cancel",
      describe: () => "Auswahl verwerfen",
      run: () => ui.selectionCancel(),
    },
    // --- Tools, menus and finders ----------------------------------------------------
    tool("tool:holzhacken", "Holzhacken", "fell", () =>
      game().state.tools.axe
        ? undefined
        : "Die Axt liegt noch in der ersten Lichtung.",
    ),
    tool("tool:pflastern", "Pflastern", "pave", () =>
      game().state.seen.has("stones")
        ? undefined
        : "Pflastern geht erst mit Steinen.",
    ),
    tool("tool:reparieren", "Reparieren", "repair"),
    tool("tool:abreissen", "Abreissen", "demolish"),
    {
      id: "tool:none",
      global: true,
      describe: () => "Kein Werkzeug",
      run: () => ui.chooseTool("none"),
    },
    {
      id: "menu:build",
      global: true,
      interactive: true,
      describe: () => "Das Bauen-Menü öffnen oder schliessen",
      run: () => ui.toggleMenuNamed("build"),
    },
    {
      id: "menu:main",
      global: true,
      interactive: true,
      describe: () => "Das Menü öffnen oder schliessen",
      run: () => ui.toggleMenuNamed("menu"),
    },
    {
      id: "find:texts",
      global: true,
      interactive: true,
      describe: () => "Start und gefundene Schriften suchen",
      run: () => ui.openFinder("/"),
    },
    {
      id: "find:commands",
      global: true,
      interactive: true,
      describe: () => "Befehle suchen",
      run: () => ui.openFinder(":"),
    },
    {
      id: "keys:open",
      global: true,
      interactive: true,
      describe: () => "Tasten und Makros ansehen und ändern",
      run: () => ui.menuAction("keys"),
    },
    {
      id: "game:reset",
      interactive: true,
      describe: () => "Neu beginnen (fragt zuerst)",
      run: () => ui.menuAction("reset"),
    },
    // --- Building and repairing ------------------------------------------------------
    {
      id: "build",
      args: [choice("ein Gebäude", () => ui.buildChoices())],
      describe: ([value]) => {
        const c = ui.buildChoices().find((b) => b.value === value);
        return c ? `${c.label} bauen · ${c.cost}` : `${value} bauen`;
      },
      unavailable: ([value]) => ui.buildUnavailable(value),
      run: ([value]) => ui.startBuilding(value),
    },
    {
      id: "place",
      args: [choice("ein Gebäude", () => ui.buildChoices())],
      describe: ([value]) => {
        const c = ui.buildChoices().find((b) => b.value === value);
        return c
          ? `${c.label} an der Cursorstelle bauen, in einem Schritt · ${c.cost}`
          : `${value} an der Cursorstelle bauen`;
      },
      unavailable: ([value]) => ui.buildUnavailable(value),
      run: ([value]) => {
        const r = ui.placeAt(value);
        return typeof r === "string" ? r : { kind: "built", ids: [r.id] };
      },
    },
    {
      id: "repair:all",
      describe: () =>
        `Alle abgenutzten Gebäude reparieren · ${ui.repairHint(worn())}`,
      run: () => work("repaired", ui.repairAll(worn())),
    },
    {
      id: "repair:worn",
      describe: () =>
        `Abgenutzte und baufällige reparieren · ${ui.repairHint(worn().filter((b) => wearLevel(b) >= 1))}`,
      run: () =>
        work("repaired", ui.repairAll(worn().filter((b) => wearLevel(b) >= 1))),
    },
    {
      id: "repair:crumbling",
      describe: () =>
        `Baufällige reparieren · ${ui.repairHint(worn().filter((b) => wearLevel(b) >= 2))}`,
      run: () =>
        work("repaired", ui.repairAll(worn().filter((b) => wearLevel(b) >= 2))),
    },
    {
      id: "repair:under",
      args: [{ kind: "number", name: "Zustand", min: 1, max: 9999 }],
      examples: [["5"], ["10"], ["20"], ["50"]],
      describe: ([n]) =>
        `Gebäude unter Zustand ${n} reparieren · ${ui.repairHint(worn().filter((b) => points(b) < Number(n)))}`,
      run: ([n]) =>
        work(
          "repaired",
          ui.repairAll(worn().filter((b) => points(b) < Number(n))),
        ),
    },
    {
      id: "repair:chosen",
      describe: () => {
        const b = ui.chosenBuilding();
        return b
          ? `${ui.nameOf(b)} reparieren · ${game().unrepairable(b) ?? (ui.costText(game().repairCost(b)) || "reparieren")}`
          : "Das gewählte Gebäude reparieren (Karte offen oder Cursor darauf)";
      },
      unavailable: () =>
        ui.chosenBuilding()
          ? undefined
          : "Kein Gebäude gewählt: öffne seine Karte oder stell den Cursor darauf.",
      run: () => {
        const b = ui.chosenBuilding();
        if (!b) return "Kein Gebäude gewählt.";
        return ui.repair(b) ?? { kind: "repaired", ids: [b.id] };
      },
    },
    {
      id: "clear:ruins",
      describe: () => `Ruinen wegräumen · ${ui.ruinsHint()}`,
      run: () => work("cleared", ui.clearRuins()),
    },
    // --- A building's card ------------------------------------------------------------
    {
      id: "card:repair",
      describe: () => "Das Gebäude der offenen Karte reparieren",
      unavailable: () => (ui.card ? undefined : "Keine Karte offen."),
      run: () => {
        const b = ui.card?.b;
        if (!b) return "Keine Karte offen.";
        return ui.repairCard() ?? { kind: "repaired", ids: [b.id] };
      },
    },
    {
      id: "crew:more",
      count: "repeat",
      describe: () => "Ein Waldmensch mehr in der Werkstatt der offenen Karte",
      unavailable: () =>
        ui.card?.crew ? undefined : "Keine Werkstatt-Karte offen.",
      run: () => ui.stepCrew(1),
    },
    {
      id: "crew:less",
      count: "repeat",
      describe: () =>
        "Ein Waldmensch weniger in der Werkstatt der offenen Karte",
      unavailable: () =>
        ui.card?.crew ? undefined : "Keine Werkstatt-Karte offen.",
      run: () => ui.stepCrew(-1),
    },
    // --- The text mode ------------------------------------------------------------------
    text("text:left", "textLeft", "Textcursor ein Zeichen nach links"),
    text("text:right", "textRight", "Textcursor ein Zeichen nach rechts"),
    text("text:up", "textUp", "Textcursor eine Zeile hoch"),
    text("text:down", "textDown", "Textcursor eine Zeile runter"),
    text("text:word-next", "wordNext", "Zum nächsten Wort"),
    text("text:word-back", "wordBack", "Zum Wortanfang zurück"),
    text("text:word-end", "wordEnd", "Zum Wortende"),
    text("text:start", "textStart", "Zum Anfang, oder mit Zahl zu der Zeile"),
    text(
      "text:end",
      "textEnd",
      "Zur letzten Zeile, oder mit Zahl zu der Zeile",
    ),
    text("text:select", "textVisual", "Zeichen auswählen", false),
    text("text:select-line", "textVisualLine", "Zeilen auswählen", false),
    text("text:other", "textOther", "Zum anderen Ende der Auswahl", false),
    text("text:copy", "textCopy", "Auswahl kopieren", false),
    // --- The saved forests ---------------------------------------------------------------
    {
      id: "forest:open",
      interactive: true,
      describe: () => "Wälder speichern, laden und als Datei",
      run: () => ui.menuAction("saves"),
    },
    forest("forest:save", "Diesen Wald unter einem Namen speichern", (f) =>
      f.save(),
    ),
    forest("forest:download", "Diesen Wald als Datei herunterladen", (f) =>
      f.download(),
    ),
    forest("forest:from-file", "Einen Wald aus einer Datei lesen", (f) =>
      f.fromFile(),
    ),
    forest(
      "forest:load",
      "Gespeicherten Wald laden",
      (f, n) => n && f.load(n),
      true,
    ),
    forest(
      "forest:download-saved",
      "Gespeicherten Wald herunterladen",
      (f, n) => n && f.downloadSaved(n),
      true,
    ),
    forest(
      "forest:delete",
      "Gespeicherten Wald löschen",
      (f, n) => n && f.delete(n),
      true,
    ),
    // --- Macros -----------------------------------------------------------------------------
    {
      id: "macro:record",
      global: true,
      interactive: true,
      describe: () =>
        commands.isRecording
          ? "Aufnahme beenden und das Makro benennen"
          : "Ein Makro aufnehmen: jeder Befehl wird mitgeschrieben",
      run: () => ui.toggleRecording(),
    },
    {
      id: "macro:replay",
      global: true,
      interactive: true,
      describe: () =>
        commands.last
          ? `Letztes Makro abspielen: ${commands.last}`
          : "Letztes Makro abspielen",
      unavailable: () =>
        commands.last ? undefined : "Noch kein Makro aufgenommen.",
      count: "repeat",
      run: () => {
        if (!commands.runText(commands.last)) return "";
      },
    },
    {
      id: "macro:run",
      args: [
        choice("ein Makro", () =>
          Object.keys(macros()).map((name) => ({ value: name, label: name })),
        ),
      ],
      describe: ([name]) => `Makro «${name}»: ${macros()[name] ?? ""}`,
      run: ([name]) => {
        const steps = macros()[name];
        if (steps === undefined) return `Das Makro «${name}» gibt es nicht.`;
        if (!commands.runMacro(name, steps)) return "";
      },
    },
    {
      id: "macro:delete",
      interactive: true,
      args: [
        choice("ein Makro", () =>
          Object.keys(macros()).map((name) => ({ value: name, label: name })),
        ),
      ],
      describe: ([name]) => `Makro «${name}» löschen`,
      run: ([name]) => {
        setMacro(name, null);
        ui.announce(`Makro «${name}» gelöscht.`);
      },
    },
    // --- Scripts (ADR 0007) -----------------------------------------------------------
    {
      // A cheat, in honour of Pascal's author: it unlocks the scripts.
      id: "niklaus:wirth",
      interactive: true,
      hidden: () => true,
      describe: () => "Skripte freischalten",
      run: () => {
        const s = scripts();
        if (!s) return "Skripte gibt es hier nicht.";
        if (!s.unlock()) return "Die Skripte sind schon freigeschaltet.";
        ui.announce(
          "Skripte freigeschaltet: im Menü unter «Skripte …», in jedem Wald.",
        );
      },
    },
    {
      id: "scripts:open",
      global: true,
      interactive: true,
      ...locked,
      describe: () => "Die Skripte: starten, anhalten, bearbeiten",
      run: () => scripts()?.open(),
    },
    {
      id: "script:run",
      args: [scriptChoice()],
      ...locked,
      describe: ([name]) => `Skript «${name}» starten`,
      run: ([name]) => {
        const why = scripts()?.start(name);
        if (why) return why;
        ui.announce(`Skript «${name}» läuft.`);
      },
    },
    {
      id: "script:stop",
      args: [scriptChoice()],
      ...locked,
      describe: ([name]) => `Skript «${name}» anhalten`,
      run: ([name]) =>
        scripts()?.stop(name)
          ? ui.announce(`Skript «${name}» angehalten.`)
          : `«${name}» läuft nicht.`,
    },
    {
      id: "script:stop-all",
      global: true,
      ...locked,
      describe: () => "Alle Skripte anhalten",
      run: () => {
        const n = scripts()?.stopAll() ?? 0;
        ui.announce(
          n === 1 ? "Ein Skript angehalten." : `${n} Skripte angehalten.`,
        );
      },
    },
    {
      id: "script:edit",
      interactive: true,
      args: [scriptChoice()],
      ...locked,
      describe: ([name]) => `Skript «${name}» bearbeiten`,
      run: ([name]) => scripts()?.edit(name),
    },
    {
      id: "script:enable",
      args: [scriptChoice()],
      ...locked,
      describe: ([name]) => `Skript «${name}» in diesem Wald einschalten`,
      run: ([name]) => {
        if (scripts()?.enabled(name))
          return `«${name}» ist in diesem Wald schon eingeschaltet.`;
        scripts()?.enable(name, true);
        ui.announce(`«${name}» ist in diesem Wald eingeschaltet.`);
      },
    },
    {
      id: "script:disable",
      args: [scriptChoice()],
      ...locked,
      describe: ([name]) => `Skript «${name}» in diesem Wald ausschalten`,
      run: ([name]) => {
        if (!scripts()?.enabled(name))
          return `«${name}» ist in diesem Wald nicht eingeschaltet.`;
        scripts()?.enable(name, false);
        ui.announce(`«${name}» ist in diesem Wald ausgeschaltet.`);
      },
    },
  );

  function scriptChoice() {
    return choice("ein Skript", () =>
      (scripts()?.names() ?? []).map((name) => ({ value: name, label: name })),
    );
  }
}
