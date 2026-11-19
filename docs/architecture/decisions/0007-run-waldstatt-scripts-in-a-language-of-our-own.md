---
tags: [adr]
status: accepted
date: 2026-11-19
amends:
  - 0003-save-the-waldstatt-in-indexeddb.md
  - 0004-keep-named-waldstatt-saves-and-files.md
  - 0006-make-waldstatt-actions-commands-that-keys-bind-to.md
sources:
  - src/waldstatt/game/script/parse.ts
  - src/waldstatt/game/script/check.ts
  - src/waldstatt/game/script/compile.ts
  - src/waldstatt/game/script/machine.ts
  - src/waldstatt/game/script/runtime.ts
  - src/waldstatt/game/script/queries.ts
  - src/waldstatt/game/scriptsDialog.ts
  - src/waldstatt/game/scriptEditor.ts
  - src/waldstatt/game/keymap.ts
  - src/waldstatt/game/commandSet.ts
  - ../../pitches/pitch--skripte.md
---

# 0007 — Run the Waldstatt's player scripts in a small language of our own

## Context

ADR 0006 made every action of the Waldstatt a named command and
added macros, fixed chains of commands. Players want scripts: variables,
conditions, loops, values read from the game and returned by commands,
waiting in game time until something holds, timeouts, and triggers by key and
by interval. Scripts are code from the player or from a file and run in the
page, so they must be sandboxed, must never freeze the page, and many of them
must be able to pause at a wait at once. Runs must survive a reload, so a
paused script's state must be data that can be saved. Commands and queries
must stay apart: a command acts and returns nothing, a query returns a value
and changes nothing. The site stays static, and its script is about 130 kB
gzipped.

An evaluation on 2026-11-19 (sizes from minified bundles, gzipped) compared:

- **JS-Interpreter** (Neil Fraser): a sandboxed ES5 interpreter of about
  27 kB that can pause on asynchronous host functions. ES5 only, about 200
  times slower than native, verbose bindings, no release from its author.
- **QuickJS in WebAssembly** (quickjs-emscripten): sandboxed, with interrupt
  handlers, but about 375 kB with the asynchronous build, which allows only
  one paused call per module.
- **Lua** (fengari, wasmoon): 70 to 150 kB, slowly maintained.
- **Evaluators in the page's own realm** (sval, SandboxJS): an escape would
  reach the page.
- **Expression languages** (jexl, expr-eval): no statements or loops.
- **A language of our own** in TypeScript: a few kilobytes, sandboxed by
  construction, a wait is a pause of one machine among many, time is the
  game's, its state is ours to write down, and the separation of commands
  and queries can be part of its grammar and checker.

For the editor, which must highlight, complete and offer vim's keys:
CodeMirror 6 (about 104 kB) with `@replit/codemirror-vim` (about 44 kB more),
prism-code-editor (about 10 kB, but no vim mode), CodeJar (no completion),
and Ace and Monaco (larger).

## Decision

As shaped in the
[pitch «Skripte»](../../pitches/pitch--skripte.md) and
implemented in [`script/`](../../../src/waldstatt/game/script/),
[`scriptsDialog.ts`](../../../src/waldstatt/game/scriptsDialog.ts)
and [`scriptEditor.ts`](../../../src/waldstatt/game/scriptEditor.ts):

- Scripts are written in a **language of our own**, parsed, checked and
  compiled in TypeScript to instructions for a small machine with an
  explicit stack, never evaluated as JavaScript. Its statements are the
  commands of ADR 0006 as typed, the script's own `cmd:` definitions,
  `var`, `if … then … else … end`, `for … in … end`, `while … end`, `wait`,
  `wait until`, `await`, `timeout`, `say`, `return`, `stop` and `import`.
- **Command-Query Separation** is part of the language: commands, the
  game's and `cmd:` definitions, are statements and return nothing; queries,
  the game's (a second, read-only registry beside the commands) and `qry:`
  definitions, are expressions and change nothing. The checker refuses a
  command, wait or `say` in a query, a value returned from a command, a
  command used as a value and a query used as a statement. `await` waits for
  a command's work to be done, which each game command declares, and
  returns nothing. Queries show only what the interface shows.
- `import <script>` brings another script's `cmd:` and `qry:` definitions.
- A **scheduler** runs scripts in game time, a limited number of steps per
  frame, each at most once at a time and at most eight at once.
- **Runs are kept with the forest** in `waldstatt-games` (amending ADR
  0003): each run with its compiled program, imports included, by a hash,
  and its state, with the machine's version; the save keeps a clock of play
  for waits and deadlines. A run continues after a reload, and with the
  version it began with after its source is edited; the next trigger runs
  the new version. Saved forests and files keep their runs (amending ADR
  0004); «Neu beginnen» ends them. Runs read back are checked like the rest
  of the save; one that does not pass is dropped.
- Script **sources** are kept by name with the keymap in
  `waldstatt-games-settings` (ADR 0005, 0006) and in its JSON and files;
  `script:run:<name>` and the other `script:` commands join the registry, so
  keys and the finder start and stop them.
- Scripts are **unlocked** once per visitor with the hidden command
  `niklaus:wirth`, typed out in the finder (in honour of Pascal's author);
  the unlock is kept in `waldstatt-games-settings` in a record of its own, not
  in the keymap's JSON. Until then the menu item, the badge and the `script:`
  commands are hidden and nothing runs. The sources are the visitor's, the
  same in every forest, but each **forest switches on** the scripts that may
  run in it («In diesem Wald», `script:enable:<name>`,
  `script:disable:<name>`); the list is saved with the forest's runs, and
  switching a script off ends its run there. Scripts stay an extra for those
  who look for them, and a forest is never steered by a script made for
  another.
- The editor is **CodeMirror 6** with a mode for the language and completion
  from the command and query registries, and **`@replit/codemirror-vim`** for
  vim's keys, both pinned dependencies, loaded as separate chunks only when
  the editor opens and when the vim mode is on.

## Consequences

- Scripts can do only what a player could do by hand, through the commands,
  and read only what the interface shows; the exploration stays a game.
- The language is ours to document, test and keep small; its grammar and
  error messages are part of the game.
- The site gains its first dependencies for one tool (about 148 kB
  gzipped at most), outside the game's own bundle; the editor works offline
  only once it was loaded online.
- Because time is the game's, scripts pause with the game and never pile up
  runs after a break.
- The save grows by the runs and their programs; a change of the machine's
  instruction set needs a new version, and older runs are dropped.
- A new forest runs no scripts until they are switched on in it; a forest
  saved before this keeps on the scripts that ran or were due in it.
- Separating commands and queries keeps scripts readable and lets the
  checker refuse mistakes early, at the cost of an extra query after a
  command, such as finding the building just placed.

## The tell

Searching `src/waldstatt` for `eval(`,
`new Function` or `Function(` should find nothing. `@codemirror/` and
`@replit/codemirror-vim` should be imported only through dynamic `import()`
from the editor's module, so the game's main chunk does not grow by them (the
build's chunk list shows it). The script machine should reach the game only
through the command and query registries; a focused test that saves a
waiting run, reloads and finds it waiting at the same instruction shows that
runs survive (`script/runtime.test.ts`, «saves runs with their programs and
continues them after a reload»). The checks cannot
prove that every limit holds under every script.
