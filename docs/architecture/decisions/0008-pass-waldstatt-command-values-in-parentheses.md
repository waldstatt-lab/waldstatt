---
tags: [adr]
status: accepted
date: 2026-11-19
amends:
  - 0006-make-waldstatt-actions-commands-that-keys-bind-to.md
  - 0007-run-waldstatt-scripts-in-a-language-of-our-own.md
sources:
  - src/waldstatt/game/commandText.ts
  - src/waldstatt/game/commands.ts
  - src/waldstatt/game/commandSet.ts
  - src/waldstatt/game/notices.ts
  - src/waldstatt/game/finder.ts
  - src/waldstatt/game/dispatch.ts
  - src/waldstatt/game/main.ts
  - src/waldstatt/game/script/parse.ts
  - src/waldstatt/game/script/check.ts
  - src/waldstatt/game/script/compile.ts
  - src/waldstatt/game/script/machine.ts
  - src/waldstatt/game/script/runtime.ts
  - src/waldstatt/game/scriptEditor.ts
  - src/waldstatt/game/scriptsDialog.ts
  - ../../pitches/pitch--befehlswerte.md
---

# 0008 — Pass the Waldstatt's command values in parentheses, and name scripts as namespaces

## Context

ADR 0006 made every action a command with an id of colon segments, its
values written as further segments (`up:15`, `repair:under:5`,
`build:hütte`), and the «:» finder, key bindings and macros share that text.
ADR 0007 let scripts run the same commands, splicing values in with `{…}`
(`up:{count}`). Segments cannot carry text with spaces, colons or
punctuation, so no command can take a message; several values are
positional and look like part of the id; and scripts need a second syntax
whose values are checked only when the line runs. Script output (`say`)
reaches only the screen reader's live region. Imports pour another script's
names into a script, so two imports with one name clash and nothing shows
where a name comes from; single names cannot be imported; a script's own
names are one word; a command the game adds later can clash with a
player's name; and a script's commands can be called only from scripts, as
the finder and keys reach a script only as a whole (`script:run:`).

The alternatives weighed in the
[pitch «Befehlswerte»](../../pitches/pitch--befehlswerte.md):
values in parentheses; shell-like values after a space
(`notify:alert "hello" 3`), which clash with expressions in scripts
(`up count * 2`); and quoted segments (`notify:alert:"Hallo Welt"`), the
smallest change but hard to read and needing escapes for colons. Macros and
scripts are not published, so no saved form needs converting.

## Decision

- A command is its id of colon segments, then its values in parentheses,
  separated by commas: `up(15)`, `repair:under(5)`,
  `notify:alert("Die Hütte steht.")`. A command without values has no
  parentheses; a value with a default may be left out.
- Values are numbers, choices and texts. Texts are new: in double quotes,
  with `\"` and `\\`, of limited length. A choice the finder lists may stay
  a segment (`build:hütte`); every value, choices too, may be given in the
  parentheses in order, so `build:hütte` and `build("hütte")` are the same.
- One reader for commands and chains serves the finder, the keymap, macros
  and scripts; `;` and `,` inside a text do not split. The finder also takes
  `up 15` as a typing shortcut. The `up:15` form is dropped without a
  conversion and without a new keymap version.
- In scripts (amending ADR 0007), values are expressions:
  `up(count * 2)`, `build(kind)`; `{…}` stays only inside texts. The checker
  knows each game command's values and refuses a wrong count, a wrong kind
  of literal and a literal out of range as the script is typed. A script's
  own `cmd:` is called as it is defined, `schritt(n, "links")`.
- The game and every script are namespaces: the game's is `waldstatt`
  (reserved as a script name), a script's is its name. `$` marks a
  namespace wherever commands and queries are written: `$helfer:hello("world")`,
  `$waldstatt:up(15)`; such a name works without an import. A script's own
  names may contain colons (`cmd:bauen:dorf(n)`).
- `import <namespace>` brings all its commands and queries into the script
  without `$`; `import <names> from <namespace>` brings only those, a single
  name renamed with `as`; `import <namespace> as <alias>` renames the
  namespace for that script (`$alias:…`). New scripts start with
  `import waldstatt`. Own definitions come first, then imported names, then
  the game; a name two imports bring is refused where it is used. The
  finder, keys and macros read commands as if `import waldstatt` stood
  above them and accept `$waldstatt:` too.
- A script's `cmd:` definitions are commands of the finder, the keys and
  macros as `$helfer:bauen:dorf(3)`, listed for scripts switched on in the
  forest once scripts are unlocked. Run there, such a command starts a run
  at that definition with literal values, known by the command, once at a
  time and saved like any run (amending ADR 0007); in a script it is a
  call within the run. Scripts' queries stay in scripts.
- `notify:info(Text)` and `notify:alert(Text)` show notices over the map,
  also read out through the live region; `say "…"` is the short form of
  `notify:info("…")`; a script's failure shows as an alert. Notices are
  capped and merge repeats.

## Consequences

- One form of a command is written, listed, bound, recorded and scripted, so
  what the finder shows can be pasted into a binding or a script.
- Commands can take text, which opens messages and later commands with
  names typed by the player.
- Scripts' values are checked earlier and read like calls, matching the
  definitions of `cmd:` and `qry:`.
- Where a name comes from is visible (`$`) or declared at the top; a command
  the game adds later never breaks a saved script, since the player's name
  wins (with a warning in the editor).
- Players can build their own commands in scripts and use them like the
  game's, from the finder and on keys; the runtime gains runs that start at
  a definition, and the keymap holds commands that may be missing or
  switched off in a forest and are refused when used.
- Commands and queries both use parentheses; only the place (statement or
  expression) tells them apart, which the checker's messages must explain.
- Bindings with texts need escaped quotes in the keymap's JSON.
- Keymaps and macros saved in the old form on development machines are
  refused with a message rather than converted.
- Sighted players see script output and failures; notices take a place on a
  map that is already busy on phones.

## The tell

Once implemented, searching `src/waldstatt` for command
literals in the old form, such as `"up:` followed by a digit or
`repair:under:` followed by a digit, should find nothing outside tests that
assert their refusal, and the default keymap should use parentheses. Unit
tests of the command reader should cover texts with `;`, `,`, `:` and
escaped quotes, and a macro chain containing them. A script test should show
`build(kind)` running `build:hütte`, and checker tests should cover
`import waldstatt as ws`, `import reihe from helfer`, a `$` name without
an import, and an ambiguous name refused where it is used; a runtime test
should start a run at a `cmd:` with values, save it and resume it. The checks cannot prove that every
message reads well or that notices never cover something on every screen.
