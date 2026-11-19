# Problem

Since [«Befehle und Tasten»](pitch--befehle-und-tasten.md), everything the
keyboard and the «:» finder do in the Waldstatt is a command,
and a macro chains commands with `;`. A macro is a fixed list run all at once:
it cannot decide anything («repair only if there is wood»), cannot wait for
the Waldleute («build the next hut once this one stands»), and runs only when
a key is pressed. A player who wants to keep a settlement going (repairing
what wears, rebuilding farms, felling as wood runs low) has to watch it and
press keys at the right moments, and anything longer than a moment is lost
when the page reloads.

The work succeeds when a player can:

- write a script in the game, in a small language made for it, with
  variables, conditions, loops, and commands and queries of their own, and
  reuse another script's commands and queries by importing it;
- query what the interface shows (stock, Waldleute and beds, motivation,
  buildings with their state and condition), while commands only act: a
  command never returns anything, a query never changes anything;
- wait in game time, for a while, until a query holds, or until a command's
  work is done, with timeouts for the whole script or a part;
- start a script from a key, from the «:» finder, by hand, or every so many
  seconds of play, down to one;
- reload the page and find running scripts carrying on where they were;
- edit a script while it runs: the run carries on with the version it began
  with, and the next start runs the new one;
- edit in an editor with highlighting, completion and errors as they are
  typed, optionally with vim's keys;
- see which scripts run, wait or failed, and stop them.

# Appetite

Big batch: six weeks. Runs that survive a reload and the separation of
commands and queries are the core and are not cut. If time runs short, cut in
this order: the «Probelauf» from the editor, completion of objects' fields
(keep completion of commands, queries and keywords), `wait until` (keep
`wait` and `await`), then the vim mode.

# Solution

![Breadboard: keys, the «:» finder, the badge and the menu start scripts or
open the dialog «Skripte»; the run waits in game time, awaits commands,
times out and is kept with the forest; the dialog lists scripts and runs of
older versions and opens the editor with highlighting, completion, errors,
vim keys and the trigger](pitch--skripte.breadboard.svg)

Editable source: [breadboard](pitch--skripte.breadboard.excalidraw).

The elements:

- **A language of our own**, written in TypeScript as a parser, a checker and
  a small machine. An evaluation found it the best fit: a few kilobytes,
  truly sandboxed, many scripts paused at once, waits in game time, and a
  state that can be written down. The alternatives were JS-Interpreter (ES5
  only, slow, verbose bindings), QuickJS in WebAssembly (about 375 kB, one
  paused call per module) and Lua builds (70 to 150 kB, slowly maintained).
  One statement per line, `#` for comments, blocks closed with `end`:

  ```
  import holzwirtschaft
  every 30s

  qry:genug-holz(n)
    return stock.wood >= n * 8
  end

  cmd:reihe(n)
    for i in 1..n
      await place:hütte
      right:3
    end
  end

  if genug-holz(3) then
    reihe:3
    say "Hütte: {building-at(cursor.x - 3, cursor.y).state}"
  else
    wait until genug-holz(3)
  end
  ```

- **Commands and queries, kept apart** (Command-Query Separation, built into
  the language):
  - **Commands** act and return nothing. They are statements, never part of
    an expression: the game's commands as typed today (`repair:all`,
    `up:20`, chains with `;`), with values put in by braces
    (`repair:under:{limit}`), and the script's own, defined with
    `cmd:name(parameters) … end` and called like the game's
    (`reihe:3`). A new game command, `place:<building>`, places a building at
    the keyboard cursor in one step.
  - **Queries** return a value and change nothing. They are expressions,
    never statements: the game's queries (`stock.wood`, `people`, `beds`,
    `mood`, `cursor.x`, `tool`, `time`, `buildings(kind)`,
    `building-at(x, y)`) and the script's own, defined with
    `qry:name(parameters) … return … end`.
  - The checker refuses, before a script can run: a command, `wait`,
    `await` or `say` inside a `qry:`; a `return` with a value inside a
    `cmd:`; a command used as a value; a query used as a statement.
  - So `await place:hütte` waits until the work is done and gives nothing
    back; the building is queried afterwards, such as with
    `building-at(x, y)`.
- **Expressions and control**: `var`, assignment, numbers, strings with
  `{…}`, `true`, `false`, `none`, `and`, `or`, `not`, comparisons,
  arithmetic, fields (`b.state`), lists (`list[0]`, `count(list)`);
  `if … then … else … end`, `for i in 0..10 … end` (both ends included),
  `for b in buildings("hütte") … end`, `while … end`, `return`, `stop`. Names
  may contain hyphens, as commands do (`genug-holz`), so subtraction needs
  spaces (`a - b`).
- **Reading** only what the interface shows. Buildings are values with
  `kind`, `name`, `x`, `y`, `state`, `condition`, `most`, `crew` and
  `repairing`, read anew by their id at each access; one that is gone reads
  as `none`. Hidden things (where unfound scrolls lie, the seed, the save)
  cannot be read.
- **Time**: `wait 30s`, `wait until <query>`, `await <command>` (each game
  command says when its work is done: a placed building stands finished,
  ordered repairs are done, ruins are cleared, marked trees are felled; if
  that can no longer happen, such as a site torn down, the script fails
  there), `timeout 2m … else … end` around a part, and `timeout` on its own
  line for the whole script (10 minutes of play by default). All in game
  time: scripts pause with the game when the tab is hidden.
- **Imports**: `import <script>` makes another script's `cmd:` and `qry:`
  definitions usable, not its other statements. Names that clash and imports
  in a circle are errors.
- **Running and keeping runs**: a small machine with an explicit stack runs
  each script a limited number of steps per frame, so no script can freeze
  the page, and wakes waiting ones as game time passes. The game keeps a
  clock of play in its save for this. A script runs at most once at a time
  (a trigger while it runs is skipped), at most eight at once. Each run
  carries its own compiled program, imports included, and its state (stack,
  variables, what it waits for, its deadlines); both are kept with the
  forest in `waldstatt-games` as the game saves, and a run carries on after
  a reload where it was. So a run started before an edit continues with the
  version it began with, shown as «ältere Fassung» in the dialog, and the
  next trigger starts the new one. «Neu beginnen» ends all runs; a forest
  saved under a name or as a file keeps its runs. A failure or timeout stops
  the run and is announced with its line and reason.
- **Triggers**: `script:run:<name>` is a command, so any key binds to it
  («Tasten») and the finder runs it; `every 30s` (or `every 1m`) as a
  script's first line starts it again and again, from one second up, while
  the page is open. `script:stop:<name>` and `script:stop-all` stop runs.
- **The dialog «Skripte»** (from the menu, a badge «▶ 2 Skripte» on the map
  while scripts run, or `scripts:open`): each script with its name, trigger
  and state (läuft, wartet, Fehler, ältere Fassung), ▶ and ■, «Bearbeiten»,
  «+ Neues Skript».
- **The editor**: CodeMirror 6 with a mode for the language, completion of
  keywords, the game's commands and queries (with their German
  descriptions), the script's own and imported ones, buildings and goods,
  and fields of values; errors, including commands and queries in the wrong
  place, marked at their line as they are typed; «Vim-Tasten» on or off,
  remembered; «Speichern», «Probelauf» and «Schliessen». It loads only when
  it opens, about 104 kB gzipped, and the vim mode only when it is switched
  on, about 44 kB more.
- **Keeping scripts**: their sources are kept by name with the keymap and
  macros in `waldstatt-games-settings`, and are part of the keymap's JSON
  and file; their runs belong to the forest.

# Security

Scripts are code from the player or from a file, and run in the page. They
are never evaluated as JavaScript: no `eval`, no `Function`, no access to the
DOM, the network, storage or the page's globals. The machine knows only its
own values; the game's state reaches it as copies of plain values, and the
only effects are the registered commands, which the player could run by hand.
Limits keep a script from harming the page: its size, the number of scripts,
imports and running ones, steps per frame, the length of strings and lists,
the depth of nesting and calls, and the timeout. Sources read back from
storage or a file are only parsed and checked, never run, until the player
starts one or its trigger is set. Saved runs are untrusted input like the
rest of the save (ADR 0003): a run's program is checked again and its state
against it on load; a run that does not pass is dropped with a notice, never
run. The editor's packages are dependencies of the site, pinned in
`package-lock.json` and bundled; nothing loads from elsewhere.

# Rabbit Holes

- **A state that can be written down.** Generators cannot be saved.
  Decision: the checked program is compiled to a list of simple instructions
  for a machine with an explicit stack; its state is plain data (numbers,
  strings, lists, building ids, the instruction pointer, the frames, what it
  waits for), written with the save.
- **Versions.** A run must not depend on a source that changed. Decision: a
  run carries its compiled program, imports included; the sources in the
  settings only start new runs. Programs of the same version are stored
  once, by a hash.
- **Changing the machine.** A later version of the language may not read old
  runs. Decision: runs carry the machine's version; one of another version is
  dropped on load with a notice, and `every` scripts start anew.
- **Game time.** Waits and timeouts need a clock that survives a reload.
  Decision: the save keeps seconds of play; deadlines are points on it.
- **What a command waits for.** Each game command declares whether it can be
  awaited and what «done» means, as ids to check (a site, buildings ordered
  for repair, ruins, marked trees); commands without work to wait for finish
  at once.
- **Commands and queries in the game's registry.** The registry of ADR 0006
  holds commands only. Decision: queries are a second registry of their own,
  read-only, which the finder does not list.
- **Placing in scripts.** Placing by keyboard needs the placing mode and
  Enter. Decision: `place:<building>` places at the cursor in one step, or
  fails with the reason.
- **Live values.** A building read twice may have changed or be gone.
  Decision: values are views by id, read anew at each access.
- **The editor's size and the offline app.** The editor is a separate chunk;
  the service worker caches it once it was loaded, so the editor works
  offline only after it was opened online once.
- **Error positions.** Every node keeps its line and column, so the editor
  can mark it and the announcement can name it.

# No-Gos

- No JavaScript, Lua or any other evaluated language, and no WebAssembly
  runtime.
- No classes or objects of the player's own beyond lists; no closures or
  functions as values.
- No commands that return values, and no queries with effects.
- No reading of hidden state: unfound scrolls, the seed, the save itself.
- No scripts running while the page is closed.
- No cron expressions beyond `every <seconds or minutes>`.
- No debugger, breakpoints or stepping.
- No sharing of scripts online; files only, as with the keymap.
