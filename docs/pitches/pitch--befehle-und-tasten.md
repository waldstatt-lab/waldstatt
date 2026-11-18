# Problem

The Waldstatt is played as much with the keyboard as with the
mouse, and keyboard players think in commands, as in an editor. The game has
two separate systems for this, and they do not meet:

- The «:» finder lists entries made up one by one in `ui.ts`: `tool:…`,
  `build:…`, `reparieren:unter-10`, `wegräumen:ruinen`, `wald:laden:…`. Some
  take a typed number (`rep 30`), most do not. Each new feature adds its own
  entries and its own parsing.
- The keymap ([ADR 0005](../architecture/decisions/0005-keep-the-waldstatt-keymap-in-a-settings-database.md))
  binds keys to a fixed list of about 30 actions in three scopes (map, text,
  card). A key cannot be bound to anything the finder can do: not «build a
  hut», not «repair everything under 10», not «move 20 tiles up».

So a player who builds huts all day cannot give it a key, and what the finder
can do and what keys can do drift further apart with every feature: the card
keys, the repair commands and the text mode each brought their own
special cases. Counts work only for movement (`20` then ↑), and the text
mode's «gg» is a special case of its own rather than a key sequence.

Editors such as Zed solve this with one idea: almost everything is an action
with a name, the command palette lists the actions, and the keymap binds keys,
or sequences of keys, to actions with arguments, in contexts, with the
player's bindings layered over the defaults.

The work succeeds when:

- everything the keyboard or the finder can do is a command with a name, such
  as `up`, `up:20`, `build:hütte`, `repair:all`, `repair:under:5`;
- the «:» finder lists every command that applies, with what it does in
  German and the key bound to it, and takes typed arguments;
- any key or sequence of keys can be bound to any command, arguments
  included, in a context;
- a count typed before a key still works: `20` then ↑ is `up:20`, and `2`
  then a key bound to `up:20` is `up:40`;
- several commands can run as one, a macro, such as
  `tool:holzhacken;selection:start;up:10;right:10;selection:confirm` or
  `build:hütte;enter;right:3`, typed in the finder, bound to a key, or
  recorded while playing and replayed;
- a player can see, change, export and import their keymap and macros,
  including as JSON.

# Appetite

Big batch: six weeks. It replaces the finder's entries and the keymap's
actions at once, so it cannot be split into a small first step without
keeping both systems alive in between. Macros come on top of that. If time
runs short, cut in this order: context expressions (keep single context
names), reading and writing files (keep the JSON field), then editing
macros in the dialog (keep recording, naming and deleting them).

# Solution

![Breadboard: the map with its keys, counts, sequences and macro recording;
the «:» finder with chains; running a command or a macro; the building card
and the text mode as contexts; ending a recording; the dialog «Tasten» with
recording a binding, editing macros and the keymap as JSON](pitch--befehle-und-tasten.breadboard.svg)

Editable source: [breadboard](pitch--befehle-und-tasten.breadboard.excalidraw).

The elements:

- **Commands.** One registry of commands, each with an id path of colon
  segments: namespace and verb in English, names of things as the game names
  them (`build:hütte`, `tool:holzhacken`, `forest:load:waldstatt-am-bach`). A
  command has a German description shown in the finder and the dialog, the
  context it applies in, its arguments (a number, a building, a game, a saved
  forest), whether it can run now and, if not, why in German, and how a count
  combines with it. Commands with a variable part (buildings, games, saved
  forests, texts) are listed from the game's state when asked. Roughly:
  - moving and viewing: `left`, `right`, `up`, `down` (each with a number),
    `zoom:in`, `zoom:out`, `goto:start`, `goto:<text>`;
  - selecting and applying: `selection:start`, `selection:other`,
    `selection:confirm`, `selection:cancel`, and `enter`, which does what
    Enter does at the cursor: apply the tool, open a building, place the
    building being placed, or begin and close an area;
  - tools and menus: `tool:holzhacken`, `tool:pflastern`, `tool:reparieren`,
    `tool:abreissen`, `tool:none`, `menu:build`, `menu:main`, `find:texts`,
    `find:commands`, `keys:open`;
  - building and repairing: `build:<building>`, `repair:all`, `repair:worn`,
    `repair:crumbling`, `repair:under:<n>`, `repair:chosen`, `clear:ruins`;
  - on a building's card: `card:repair`, `crew:more`, `crew:less`;
  - in the text mode: `text:left` … `text:word-next`, `text:start`,
    `text:end`, `text:select`, `text:select-line`, `text:copy`;
  - the saved forests: `forest:save`, `forest:load:<name>`, and the rest of
    today's `wald:…` entries;
  - macros: `macro:record` (starts and stops), `macro:replay` (the last
    one), `macro:run:<name>`, `macro:delete:<name>`.
- **Counts.** A count typed before a key reaches the command it runs: a
  command that takes a number gets the count as its number, or its bound
  number times the count; a command that makes sense again and again
  (`crew:more`) runs that many times; for the rest the count is dropped. A
  count before a macro runs the whole macro that many times: `4` then a key
  bound to `build:hütte;enter;right:3` builds four huts in a row. A badge
  shows the count, as today.
- **Macros.** A chain of commands joined by `;`, run one after the other.
  It can be typed in the finder, bound to a key like a single command, or
  saved under a name as `macro:run:<name>`. Positions in a macro are relative
  to the keyboard cursor, so the same macro works anywhere. If a step cannot
  run (not enough wood, a tree in the way), the macro stops there and says
  which step and why; what already happened stays. Commands that open a
  menu, a finder or a dialog cannot be part of a macro.
- **Recording.** `macro:record` (q by default, as in vim) starts a recording,
  shown in a badge «● Aufnahme». Every command run meanwhile, by key or by
  the finder, is written down with its count folded in (`20` then ↑ is
  recorded as `up:20`); taps and drags with the pointer are not. q again
  stops it and offers to name it: named, it is kept and can be bound; without
  a name it is only the last macro, which `macro:replay` (@ by default)
  runs.
- **Contexts.** Where a binding applies: `map`, `placing`, `reading` (a text
  or the stage turned top-down), `text` (the text mode), `card` (a
  building's card is open). A binding names one context, or an expression
  of them with `&&`, `||`, `!` and parentheses, as in Zed. The innermost
  context wins; within one, the player's binding wins over the default.
- **Key sequences.** A binding's keys may be a sequence, such as `g g`. After
  a key that starts a longer sequence in the current context, the game waits
  up to a second for the next one and shows the keys so far in a badge, as it
  shows a count.
- **The keymap.** Bindings of keys to commands with arguments, in contexts:
  the defaults, and the player's own layered on top, where `null` takes a
  default key away. One dispatcher reads every key press (count, sequence,
  context, binding) and runs the command; the special handlers for the map,
  the text mode and the card go.
- **The «:» finder** completes segment by segment: `repair:` offers `all`,
  `worn`, `under` …, and a number can be typed where one is taken. Every entry
  shows its German description and the key bound to it; commands that cannot
  run now show greyed with the reason. Enter runs the command, as a key
  would.
- **The dialog «Tasten»** lists the bindings by context, each with its keys,
  its command (or chain) and description, and ×. «+ Bindung» records keys (a
  single key or a sequence, ended with «Fertig»), then picks the command or
  types a chain with the same finder, arguments included, and the context; a
  key already bound there asks whether to replace it. A section «Makros»
  lists the named macros with their steps; each can be edited as its chain,
  with errors named by step, or deleted. «Als JSON bearbeiten» shows the
  player's own bindings and macros as JSON in a text field, in Zed's shape (a
  list of contexts, each with its bindings, and the macros by name);
  «Übernehmen» checks it and lists errors with their line; it can be
  downloaded and read back from a file. «Standard» brings the default
  bindings back after asking and keeps the macros.
- **What stays.** The pointer, touch and toolbox work as today, though the
  toolbox's buttons run the same commands. The theatre's game previews keep
  the controls from each game's documentation. Help texts, announcements and
  the map's description are written from the keymap, as today.

# Security

The keymap is read from the settings database, from the JSON field and from
files, and all three are untrusted input, as in ADR 0005: a size limit,
a fixed schema, command ids checked against the registry and their arguments
checked by each command, context expressions parsed by a small grammar and
never evaluated as code, keys checked against what can be bound. Macros are
the same: every step is a registered command with checked arguments, never
code; a macro has at most 200 steps, a run at most 10,000 (counts
included), and a macro cannot run itself, directly or through another, so
an imported keymap cannot freeze the page. An invalid binding or macro is
reported with its line or step and not stored. Everything is set as text,
never as HTML. Files are read with the file picker and written with a blob
URL; nothing goes over the network.

# Rabbit Holes

- **Command ids for names.** Buildings, games and saved forests have spaces,
  capitals and colons. Decision: each such name appears as a lower-case slug
  with hyphens, as the finder does today; a name that would collide gets a
  number.
- **Completing every argument.** Saved forests and texts can be many.
  Decision: the finder lists the variable part only once its segment is
  reached, and only what matches.
- **Sequences against single keys.** `g` alone and `g g` in one context would
  make every `g` wait. Decision: the wait happens only where a longer
  sequence exists in the current context, and the dialog says so when one is
  recorded.
- **Counts in the text mode and in sequences.** Decision: the count comes
  before the first key of a sequence (`5 g g`), as in vim; digits are never
  bindable, as today.
- **Key names and layouts.** Today's keymap stores the browser's key values
  (`ArrowUp`, `G`). Decision: the JSON uses readable names (`up`, `enter`,
  `space`, `shift-g`, single characters as typed), mapped from and to the
  browser's values; letters on the map ignore Shift, as today, because Shift
  pans.
- **Migrating ADR 0005's keymap.** A stored keymap of version 1 becomes
  bindings of version 2 once, each action mapped to its command; what cannot
  be mapped falls back to the defaults.
- **A code editor for the JSON.** Decision: a plain text field with the
  errors listed below it, no highlighting or completion.
- **Time inside a macro.** Waldleute need time to fell and build; a macro
  cannot wait for them. Decision: a macro runs all its steps at once, in one
  frame, and orders work as a player would (marking, placing, repairing);
  it does not wait for the work. Steps that need the game to move on are not
  commands.
- **Relative or absolute positions.** A recording of cursor moves replays
  from wherever the cursor is; a recording that also jumped to the first
  clearing (`goto:start`) replays from there. Decision: record exactly the
  commands run; no recording of absolute tiles, and no pointer input.
- **Placing in a macro.** `build:hütte` starts placing at the cursor, and
  `enter` places it, as with the keyboard today. Decision: placing started
  by a macro always follows the keyboard cursor, never the pointer.
- **Macros that change keys or macros.** `macro:record` or `macro:delete`
  inside a macro would change what is running. Decision: macro and keymap
  commands, like those that open a menu or dialog, cannot be macro steps.

# No-Gos

- No keys with Ctrl, Alt or Cmd: the browser and the system keep them, as in
  ADR 0005.
- No conditions, loops or variables in macros: a macro is a fixed chain, and
  a count is its only repetition.
- No replaying raw keystrokes (Zed's `SendKeystrokes`): macros are made of
  commands, so they keep working when keys are rebound.
- No recording of pointer or touch input, and no undo of a macro.
- No binding of mouse buttons, wheel or touch gestures.
- No changing the game previews' controls on the stage.
- No commands with free text arguments other than names the game already
  knows (no `build:anything`).
- No syncing keymaps between devices, and no keymaps per forest.
