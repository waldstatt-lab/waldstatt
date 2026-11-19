---
tags: [adr]
status: accepted
date: 2026-11-18
amends:
  - 0003-save-the-waldstatt-in-indexeddb.md
amended-by:
  - 0007-run-waldstatt-scripts-in-a-language-of-our-own.md
  - 0005-keep-the-waldstatt-keymap-in-a-settings-database.md
sources:
  - src/waldstatt/game/saves.ts
  - src/waldstatt/game/savesDialog.ts
  - src/waldstatt/game/state.ts
  - src/waldstatt/game/main.ts
  - ../../pitches/pitch--waelder-speichern.md
---

# 0004 — Keep named Waldstatt saves in a database of their own, and as files

**Amended by [ADR 0007](0007-run-waldstatt-scripts-in-a-language-of-our-own.md):**
saved forests and files carry the scripts' runs, as part of the save.

**Amended by [ADR 0005](0005-keep-the-waldstatt-keymap-in-a-settings-database.md):**
the keymap lives in a third database, `waldstatt-games-settings`, which
«Neu beginnen» and loading leave alone; the tell's list of database names
grows by it.

## Context

[ADR 0003](0003-save-the-waldstatt-in-indexeddb.md) keeps one forest, the
one being played, in the IndexedDB database `waldstatt-games`, and «Neu
beginnen» deletes that database. The
[pitch «Wälder speichern»](../../pitches/pitch--waelder-speichern.md)
lets visitors save forests under a name, load one in place of the forest being
played, and download and read back forests as files.

Two questions follow: where saved forests live, so that a reset does not take
them, and how loading one replaces the forest being played without another tab
or this page's own saving writing the old forest back.

Alternatives considered for where they live:

- **A third store in `waldstatt-games`.** One database, but «Neu beginnen»
  would have to clear stores instead of deleting the database, and ADR 0003's
  reset would lose its simple rule.
- **A database of their own, `waldstatt-games-saves`.** Chosen. The reset
  stays as it is, and the saved forests outlive it.
- **Files only.** No storage to manage, but saving a forest would always mean a
  download, which phones handle poorly.

Alternatives considered for loading:

- **Delete the database and write the new forest**, as a reset does. If the
  write fails, the old forest is gone.
- **Write in place and reload.** Other tabs keep their connection and could
  save their old forest over it.
- **Open the database at a higher version, then replace all records in one
  transaction.** Chosen: the version change makes the other tabs let go, as a
  reset does, and the transaction leaves the old forest if it fails.

## Decision

- A forest saved under a name is a snapshot: the save's settlement and people
  records and every chunk record, as `state.ts` stores them. Snapshots live in
  the IndexedDB database `waldstatt-games-saves`, store `saves`, keyed by the
  cleaned name, with the time and counts for the list; at most 200.
  [`saves.ts`](../../../src/waldstatt/game/saves.ts) reads and
  writes it with the raw API, as ADR 0003's wrapper does.
- «Neu beginnen» still deletes only `waldstatt-games` and the old keys; it
  leaves `waldstatt-games-saves`.
- Loading a saved forest or a file checks the snapshot with the save's own
  checks first, then stops this page's saving, opens `waldstatt-games` at the
  next version so other tabs let go, replaces its records in one transaction,
  and reloads the page.
- A file is the snapshot as JSON with `format: "waldstatt-games"`, the name and
  the time, and chunk bytes in base64. It is made with a blob URL and read with
  the file picker; nothing goes over the network. A file read is added to the
  saved forests before it is offered for loading.
- Saved forests and files are untrusted input, as in ADR 0002: they pass the
  save's checks and limits before anything is stored or replaced, files are at
  most 32 MB, names are cleaned and set as text only.

ADR 0003 stays accepted and notes this amendment below its title.

## Consequences

- Visitors can keep settlements across resets, try risky things, and carry a
  forest to another browser or computer.
- A second database to know about: inspecting or clearing the Waldstatt's
  storage by hand covers both.
- Snapshots copy the whole forest, so saving one writes every chunk; that is
  fine for an action a visitor takes by hand.
- A saved forest or file of another save version is refused, not converted;
  a format change makes them unreadable unless a migration is written.
- Browsers may still evict both databases; files are the visitor's backup.

## The tell

- `rg -n "indexedDB\.(open|deleteDatabase)" src` finds matches only in
  `src/waldstatt/game/state.ts` (`waldstatt-games`) and
  `saves.ts` (`waldstatt-games-saves`).
- `rg -n "deleteDatabase" src` finds only `waldstatt-games`, never the saves'
  database.
- `rg -n "restore\(" src/waldstatt` finds every path from a
  saved forest or a file into the game going through `restore()` in `state.ts`.

A search cannot show that a failed load leaves the old forest. Check it by hand:
load a broken file, and load a saved forest while another tab is open.
