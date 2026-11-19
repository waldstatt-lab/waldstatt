# Architectural decision records

ADRs explain lasting architectural choices and their tradeoffs. Read them alongside
the [current architecture](../README.md) and [contribution guide](../../../CONTRIBUTING.md).
Routine refactoring and individual implementation details do not need a record.

## Recording a decision

Copy [the template](_adr-template.md) to `NNNN-<slug>.md`, using the next four-digit
number starting at `0001`, and add a link and status to the index below. Include
Context, Decision, Consequences, and The tell.

Use `proposed` for unimplemented choices, `accepted` for implemented choices,
and `superseded` for replaced choices. Use the recording date; for retrospective
records add `recorded: true` and distinguish observed code from reconstructed
tradeoffs. Do not invent historical discussions or imply that a recording date is
the implementation date.

Preserve accepted rationale. For replacements, use `supersedes` / `superseded-by`
on the new and old records and mark the old record superseded. For partial changes,
use `amends` / `amended-by`, keep both records accepted, and explain the amendment
below the old title. Update both sides and the index.

Keep Markdown links and lineage paths relative to the ADR file. In `sources`,
code paths are repository-relative and document paths are ADR-relative. Remove
unused metadata and placeholders before accepting a record.

**The tell** identifies a repository-root search, focused test, or manual review
that can expose drift. State the expected result and limitations; a search alone
does not prove correctness.

## Decision index

| Record | Status |
| --- | --- |
| [0001 — Build a static site with Astro and daisyUI on GitHub Pages](0001-build-a-static-site-with-astro-and-daisyui.md) | accepted; amended by 0002 |
| [0002 — Make the Waldstatt a browser game that gates its content](0002-make-the-waldstatt-a-browser-game.md) | accepted; amends 0001; amended by 0003 |
| [0003 — Save the Waldstatt in IndexedDB](0003-save-the-waldstatt-in-indexeddb.md) | accepted; amends 0002; amended by 0004, 0007 |
| [0004 — Keep named Waldstatt saves in a database of their own, and as files](0004-keep-named-waldstatt-saves-and-files.md) | accepted; amends 0003; amended by 0005, 0007 |
| [0005 — Let visitors bind the Waldstatt's keys, kept in a settings database](0005-keep-the-waldstatt-keymap-in-a-settings-database.md) | accepted; amends 0004; amended by 0006 |
| [0006 — Make the Waldstatt's actions named commands that keys bind to](0006-make-waldstatt-actions-commands-that-keys-bind-to.md) | accepted; amends 0005; amended by 0007 |
| [0007 — Run the Waldstatt's player scripts in a small language of our own](0007-run-waldstatt-scripts-in-a-language-of-our-own.md) | accepted; amends 0003, 0004, 0006 |
