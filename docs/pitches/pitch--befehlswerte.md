# Problem

Since [«Befehle und Tasten»](pitch--befehle-und-tasten.md) every action in the
Waldstatt is a command, and since [«Skripte»](pitch--skripte.md)
scripts run them. A command takes its values as further colon segments:
`up:15`, `repair:under:5`, `build:hütte`. That was enough for a number or a
name from a list, but it breaks down as soon as commands need more:

- **No text.** A segment ends at the next colon, and a command at the first
  space, so a value can only be a single word. A command that shows a message,
  such as «Die Hütte steht, 12 Holz übrig.», cannot be written at all.
- **Several values read badly.** `schritt:15:links` is positional and
  unnamed; nothing in it says which segment is a value and which is part of
  the command's name, so `repair:under:5` and `script:run:abc` look alike
  though one ends in a number and the other in a choice.
- **Scripts need a second syntax.** A value from a variable is spliced into
  the text with `{…}` (`up:{count * 2}`), which is checked only when the line
  runs and is easy to get wrong (`up: {n}` is an error, `up:{n / 2}` fails
  at run time with «7.5 ist keine Zahl»).
- **Imports are flat and names unmarked.** `import helfer` pours another
  script's `cmd:` and `qry:` into the script; two imports with the same name
  are an error, and nothing shows whether `reihe` comes from the game, the
  script itself or an import. A script's own names are one word, so they
  cannot be grouped as the game groups `repair:…`; a script cannot take a
  single name from another; and a name the game adds later can clash with a
  player's.
- **A script's commands stay inside scripts.** A useful `cmd:bauen:dorf(n)`
  can only be called from another script; the finder and the keys reach a
  script only as a whole, with `script:run:`, so every value needs a script
  of its own.
- **Script output is invisible.** `say "…"` goes to the screen reader's live
  region and nowhere else; a sighted player never sees it, nor a script that
  stops with an error unless the dialog «Skripte» is open.

The commands' grammar is shared by the «:» finder, key bindings, macros and
scripts (ADR 0006, ADR 0007), so it has to be fixed in one place for all of
them. Macros and scripts are not published yet, so the grammar can change
without converting anything saved.

The work succeeds when a player can:

- give a command numbers and texts, several of them, in one readable form,
  the same in the finder, in a key binding, in a macro and in a script;
- pass a script's values to commands as expressions, checked as they are
  typed;
- call a script's own `cmd:` the way it is defined;
- use another script's commands and queries by its name, with or without
  importing it, import single names, and see where each name comes from;
- find a script's commands in the «:» finder, run them there, bind them to
  keys and put them in macros, as `$helfer:bauen:dorf(3)`;
- see a script's messages and failures on the map, and bind a message to a
  key.

# Appetite

Big batch: six weeks. One grammar for every place a command is written, text
values, namespaces with imports, scripts' commands in the finder and on keys,
and visible notices are the core and are not cut. If time runs short, cut in
this order: «Skript öffnen» on a notice, merging repeated notices (keep the
cap on how many show), descriptions of scripts' commands from their comments
(keep a plain one), the signature hint in the editor's completion (keep the
completion of the command itself), `as` on a single imported name, renaming
the game's namespace (keep `import waldstatt` and renaming scripts'
namespaces).

# Solution

![Breadboard: on the map, a count before a key runs up(15), recording writes
up(3);right(2) into the macros of «Tasten», and a key bound to
notify:alert("Pause!") shows a notice; the «:» finder takes up(15), up 15 and
repair:under(5), lists up(Felder), notify:info shows a notice, and
$helfer:bauen:dorf(3) starts a script's command; «Tasten» binds
$helfer:bauen:dorf(2) and checks each value of each step; the script editor
passes expressions as values, completes up( with its signature, marks wrong
values as they are typed, writes import waldstatt, import reihe from helfer
and $helfer:hello("world"),
and say and notify show notices; the notices on the map fade (info) or
stay until closed (alert), show a script's failure, and open the script
(«Skript öffnen»)](pitch--befehlswerte.breadboard.svg)

Editable source: [breadboard](pitch--befehlswerte.breadboard.excalidraw).

The elements:

- **The colon picks the command; parentheses carry its values.** A command
  is written as its id, colon segments as today, then its values in
  parentheses, separated by commas:

  ```
  up(15)
  repair:under(5)
  notify:alert("Die Hütte steht, 12 Holz übrig.")
  build:hütte
  script:run:wache
  ```

  A choice the finder can list (a building, a script, a saved forest, a
  macro) may stay a segment, as `build:hütte`, because that is how the
  finder lists and completes it. Every value, a choice too, may instead be
  given in the parentheses, in order: `build:hütte` and `build("hütte")` are
  the same command. That second form is what a script needs to pass a choice
  from a variable: `build(kind)`. A command without values is written
  without parentheses (`enter`, `repair:all`); a value with a default may be
  left out (`up` is `up(1)`, as today).
- **Three kinds of value.** Numbers (whole numbers in the command's range,
  as today), choices (one of the command's list, as today), and **texts**,
  new: in double quotes, with `\"` and `\\` for a quote and a backslash, up
  to a few hundred characters. A text may hold colons, commas, semicolons
  and spaces.
- **The same form everywhere.** The «:» finder reads `up(15)` and, as a
  shortcut for typing, still `up 15`; it lists each command with the names
  of its values, such as `up(Felder)`, `repair:under(Zustand)`,
  `notify:alert(Text)`, and says which value does not fit and why. Key
  bindings and macros hold the same text: `up(3);right(2)`, with `;` and `,`
  inside a text not splitting anything. Recording writes this form. A count
  before a key fills or multiplies the first number as today: «15», then ↑
  runs `up(15)`. The default bindings and examples change to it. The old
  `up:15` form goes away instead of being converted.
- **In scripts, values are expressions.** `up(count * 2)`,
  `repair:under(min(stock.wood, 10))`, `build(kind)`,
  `notify:info("{n} Hütten stehen")`. `{…}` is no longer spliced into
  commands; it stays only inside texts. The checker knows each game
  command's values: it refuses the wrong number of them, a text where a
  number belongs and a literal out of range as the script is typed;
  computed values are checked when the line runs, and a number that is not
  whole fails there with the line, as today. A script's own `cmd:` is called
  as it is defined, `schritt(count, "links")` for `cmd:schritt(n, wohin)`,
  and its values keep their types. `await` works as before: `await
  place:hütte`, `await build(kind)`.
- **Namespaces, marked with `$`.** The game and every script are
  namespaces: the game's is `waldstatt`, a script's is its name (so no
  script may be called `waldstatt`). `$` marks a namespace wherever a
  command or query is written, in scripts, the finder, key bindings and
  macros alike, so a name with `$` never clashes with anything:
  `$helfer:hello("world")`, `var n = $helfer:summe(4)`,
  `$waldstatt:up(15)`, `$waldstatt:stock.wood`. A name with its namespace
  works without an import. A script's own names may have colons, to group
  them as the game does: `cmd:bauen:dorf(n)` is `bauen:dorf(3)` in its
  script and `$helfer:bauen:dorf(3)` elsewhere.
- **Imports.** An import changes how names are written in the script that
  has it:

  ```
  import waldstatt                 # the game's names without $: up(15), stock.wood
  import helfer                    # all of helfer's names without $: reihe(3)
  import verwalter as v            # verwalter's names as $v:pruefe()
  import reihe, summe from helfer  # only these two, without $
  import bauen:dorf as dorf from helfer
  ```

  `import <namespace>` brings all its commands and queries in, to be used
  without `$`; `import <names> from <namespace>` brings only those, and `as`
  renames a single name; `import <namespace> as <alias>` renames the
  namespace for this script, and its names are written `$alias:…`. Every new
  script starts with `import waldstatt` at the top, so the game's commands
  read as in the finder; `import waldstatt as ws` gives `$ws:up(15)` and
  `$ws:stock.wood` instead, and a script without either writes
  `$waldstatt:`. The finder, key bindings and macros read commands as if
  `import waldstatt` stood above them, and take `$waldstatt:up(15)` too, so
  a line copied from a script runs there.
- **Scripts' commands in the finder and on keys.** In the «:» finder, `$`
  lists the namespaces of the scripts switched on in this forest, and
  `$helfer:` lists that script's `cmd:` definitions with their values, such
  as `$helfer:bauen:dorf(n)`, described by the comment above the
  definition. Run there, bound to a key or written in a macro,
  `$helfer:bauen:dorf(3)` starts a run of that command with these values,
  like `script:run:` starts a whole script: in game time, shown in the
  dialog «Skripte» and by the badge, kept with the forest, once at a time,
  within the limit of runs. Called from another script it is a call within
  that run, as today. A script's queries are not listed; the finder runs
  commands.
- **Notices.** Two commands, `notify:info(Text)` and `notify:alert(Text)`,
  show a notice over the map: an info fades after a few seconds, an alert
  stays until it is closed with its ×. Both are also read out through the
  live region. They are ordinary commands: in the finder, bindable to keys,
  recordable in macros, and run by scripts. `say "…"` stays in the language
  as the short form of `notify:info("…")`. A notice from a script names the
  script and offers «Skript öffnen», which opens it in the editor; a script
  that stops with an error shows an alert with its line and reason. A few
  notices show at once, the newest first; the same text again merges into
  one with a count instead of piling up.
- **The editor follows.** Highlighting knows the parentheses and texts of a
  command; completion of a command inserts `up(` and shows its signature
  («up(Felder: 1–9999)»); the checker's errors about values are marked as
  they are typed.

# Security

Nothing new reaches the page from outside. Texts in commands come from the
player, from a keymap file or from a script, all already untrusted (ADR
0005, ADR 0007): they are parsed by the commands' own reader, never
evaluated, limited in length, and a notice shows them as text
(`textContent`), never as HTML. A keymap file with a malformed command is
refused line by line as today. Notices are capped and merged, so a script in
a loop cannot flood the page with nodes. A script's command reached from
the finder or a key runs only when scripts are unlocked and the script is
switched on in this forest, under the same limits as any run.

# Rabbit Holes

- **Quotes inside JSON.** A binding to `notify:alert("Pause!")` is stored in
  the keymap's JSON as `"notify:alert(\"Pause!\")"`. Decision: accept the
  escaping in the JSON file; the dialog «Tasten» shows and takes the plain
  command, so only those who edit the JSON by hand meet it.
- **Splitting chains.** Macros split on `;` today with a plain split.
  Decision: one reader for a command and its values, used by the finder, the
  keymap, macros and scripts; it reads texts with their escapes, so `;` and
  `,` inside a text stay in it.
- **Texts outside scripts.** `{…}` in a text means a value only in a script.
  Decision: in the finder, a binding or a macro a text is literal; `{` has no
  meaning there.
- **Commands and queries both use parentheses.** `building-at(x, y)` is a
  query, `up(3)` a command. Decision: the place decides, as today: a
  statement is a command, an expression a query; the checker already refuses
  a query as a statement and a command as a value, and its messages say so.
- **A choice from a variable.** A segment is literal, so a script cannot
  write `build:{kind}` any more. Decision: every value may go in the
  parentheses, choices too, so `build(kind)` is the form for computed
  choices; the finder keeps listing choices as segments.
- **Counts and number values.** A count before a key must still find "the
  number" of a command. Decision: it applies to the first number value, as
  `count: "number"` does today.
- **Where notices sit.** The map already has the resources panel, the
  toolbox, the scripts badge, the recording mark and toasts over buildings,
  and the phone layout is tight. Decision: notices get one place of their
  own on the map, chosen when it is built and checked at desktop and phone
  widths; they never cover the toolbox.
- **Which name is meant.** A name with `$` is always clear; one without can
  come from the script, from several imports and from the game. Decision: a
  script's own definitions come first, then the names it imports, then the
  game; a name that two imports both bring is refused where it is used
  (never at the import), with both meanings and how to write it with `$` or
  `as`.
- **Names the game adds later.** A new game command may take a name a
  player's script already defines or imports. Decision: by the order above
  the player's name wins, so saved scripts keep working; the editor shows a
  warning there that points to `$waldstatt:` for the game's.
- **What a run carries.** A run keeps its program with everything it uses
  (ADR 0007). Decision: a script named only with `$`, without an import, is
  part of the program like an import, within the same limit of scripts and
  with cycles refused.
- **Runs that start at a command.** Today a run starts at the top of a
  script and is known by the script's name. Decision: a run may start at
  one of the script's `cmd:` definitions with values; it is known by the
  command (`$helfer:bauen:dorf`), runs once at a time, counts towards the
  limit of runs, and is saved and resumed like any run. A script's top level
  does not run when one of its commands is started.
- **Values a script's command takes.** A `cmd:`'s parameters have no kinds,
  so the finder cannot check `$helfer:bauen:dorf("drei")`. Decision: the
  finder and the keymap check only the number of values; the script checks
  the rest when it runs and stops with the line, as a notice.
- **Macros and runs.** A macro does not wait. Decision: a step
  `$helfer:bauen:dorf(2)` starts the run and the macro goes on at once.
- **Locked, switched off, renamed or deleted scripts.** Decision: a script's
  commands are listed only when scripts are unlocked and the script is
  switched on in this forest; a binding or macro to a command that is
  missing or switched off is kept and refused with the reason when used,
  like a binding to a missing macro.
- **Completion by namespace.** After `$` the finder and the editor offer
  the namespaces, after `$helfer:` or `$v:` that namespace's names, and
  after `$waldstatt:` the game's; highlighting marks the namespace.
- **Notices and focus.** A notice must not take the keyboard's focus from
  the map. Decision: notices are not focusable until reached with Tab;
  their × and «Skript öffnen» are buttons reached like the rest of the page.

# No-Gos

- No named values (`up(by: 15)`); values are positional.
- No conversion of keymaps, macros or scripts in the old `up:15` form; they
  are not published, and old forms are refused with a message.
- No values in key bindings that are computed (`up(stock.wood)`); outside
  scripts, values are literals.
- No values for scripts themselves (`script:run:wache(5)`); scripts still
  start without arguments.
- No scripts' queries in the finder or on keys; they are read in scripts.
- No waiting in macros for a script's command to finish.
- No namespaces beyond the game's, the scripts' and the colons in their
  names, and no importing of a group of names by a prefix (`bauen:*`).
- No turning every announcement into a notice: game events and command
  refusals stay in the live region as today; only `notify:`, `say` and a
  script's failure become notices.
- No notice history, sounds or desktop notifications.
