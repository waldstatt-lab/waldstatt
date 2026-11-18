---
tags: [adr]
status: proposed
date: 2026-11-19
amends:
  - 0005-keep-the-waldstatt-keymap-in-a-settings-database.md
sources:
  - src/waldstatt/game/keys.ts
  - src/waldstatt/game/keysDialog.ts
  - src/waldstatt/game/input.ts
  - src/waldstatt/game/ui.ts
  - ../../pitches/pitch--befehle-und-tasten.md
---

# 0006 — Make the Waldstatt's actions named commands that keys bind to

## Context

ADR 0005 lets visitors bind keys to a fixed list of actions in three scopes,
kept in `waldstatt-games-settings`. The «:» finder grew beside it with its own
entries (`tool:…`, `build:…`, `reparieren:…`, `wald:…`), each written and
parsed on its own in `ui.ts`. What a key can do and what the finder can do
have drifted apart: a key cannot build a hut or repair everything under 10
points, and the finder cannot move the cursor. Each feature added special
cases to both (the building card's keys, typed repair thresholds, the text
mode's «gg»).

Alternatives considered:

- **Keep two systems and add actions as needed.** Each new key would still
  need a finder entry and the other way round; the drift goes on.
- **Bind keys to finder entries by their label.** The labels are made up per
  feature and take no arguments, so `up:20` or `repair:under:5` could not be
  bound.
- **One registry of named commands, which the finder lists and keys bind to,
  as in the Zed editor.** Chosen; shaped in the
  [pitch «Befehle und Tasten»](../../pitches/pitch--befehle-und-tasten.md).

## Decision

Proposed, not implemented.

- Every action of the keyboard and the finder is a **command** in one
  registry, with an id path of colon segments (`up`, `up:20`, `build:hütte`,
  `repair:under:5`). Namespaces and verbs are English identifiers; names of
  things stay as the game names them, as lower-case slugs. Each command has a
  German description, which the interface shows wherever the command appears,
  so the site's text stays German.
- The **keymap** binds keys, or sequences of keys, to commands with their
  arguments, in **contexts** (`map`, `placing`, `reading`, `text`, `card`, and
  expressions of them). The visitor's bindings are layered over the defaults;
  `null` removes a default. A count typed before a key reaches the command:
  as its number, multiplying its bound number, as repetitions, or not at all,
  as the command declares.
- A **macro** is a chain of commands joined by `;`, run in order in one
  frame and stopped at the first step that cannot run. Macros are typed,
  bound like commands, recorded from the commands run while recording, and
  kept by name. They are made of commands, not keystrokes, so they survive
  rebinding; a count repeats a whole macro. Commands that open menus,
  finders or dialogs, and commands that change keys or macros, are not
  allowed as steps; lengths and runs are limited, and a macro cannot run
  itself.
- The keymap and the named macros stay in `waldstatt-games-settings`
  (ADR 0005) as a record of a new version; a stored keymap of version 1 is
  converted once. Both can be edited as JSON in the dialog «Tasten» and
  exported and imported as a file, checked like every other untrusted input.

Once implemented, this record becomes accepted, and ADR 0005 is marked
amended by it.

## Consequences

- Keys and the finder cannot drift apart: a feature adds commands, and both
  get them.
- Visitors can bind any command, arguments included, which makes the
  keyboard far more capable and the keymap larger to check.
- Command ids are English identifiers on a German site. They are typed and
  bound, not read as prose; the descriptions shown with them are German.
- The JSON format and the command ids become a public surface: renaming a
  command breaks visitors' keymaps unless it is migrated.
- Key handling moves into one dispatcher, which replaces the special
  handlers for the map, the text mode and the building card.
- Macros make repetitive play quick (rows of huts, clearing squares), and they
  only ever do what a player could do by hand in the same order; they do not
  wait for Waldleute to finish work.

## The tell

Once implemented: searching `src/waldstatt/game` for
`FinderItem` or for keys compared in `keydown` handlers outside the
dispatcher should find nothing. Every entry of the «:» finder should come
from the registry, and every default binding should name a registered
command; a manual check of the dialog «Tasten» should show a description for
each binding. The search cannot prove that every command is reachable by
keyboard.
