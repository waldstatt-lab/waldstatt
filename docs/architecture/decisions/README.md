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
| [0002 — Make the Waldstatt a browser game that gates its content](0002-make-the-waldstatt-a-browser-game.md) | accepted; amends 0001 |
