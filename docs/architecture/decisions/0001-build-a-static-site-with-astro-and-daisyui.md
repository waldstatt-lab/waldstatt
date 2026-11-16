---
tags: [adr]
status: accepted
date: 2026-11-15
sources:
  - package.json
  - astro.config.mjs
  - src/waldstatt/styles.css
  - .mise/config.toml
  - .github/workflows/pages.yml
  - .github/workflows/ci.yml
---

# 0001 — Build a static site with Astro and daisyUI on GitHub Pages

## Context

The studio needs a website with a home page, an about page, and one page per game
that explains the game idea and links to its GitHub Pages deployment. The games are
already published on GitHub Pages, and the site must be static so it can be
published the same way, without a server.

Alternatives considered:

- **Plain HTML and CSS.** No toolchain, but every page would repeat the layout
  and the game texts by hand.
- **Astro** with Tailwind CSS and daisyUI, chosen by the team: components and
  typed Markdown content collections, static output by default, and daisyUI themes
  that give the site a distinct look with little CSS.

## Decision

Build the site with Astro 7 into static files in `dist/`, styled with Tailwind CSS 4
and daisyUI 5; `@tailwindcss/typography` styles the Markdown game texts. Versions
are pinned exactly in [package.json](../../../package.json) and locked by
`package-lock.json`. [.mise/config.toml](../../../.mise/config.toml) pins Node.js,
and mise tasks wrap the npm scripts (`install`, `dev`, `build`, `preview`, `check`,
`fmt`).

[pages.yml](../../../.github/workflows/pages.yml) builds on every push to `main` and
deploys `dist/` to GitHub Pages. `actions/configure-pages` provides the origin and
base path, which [astro.config.mjs](../../../astro.config.mjs) reads from
`SITE_URL` and `BASE_PATH`; internal links go through `href()` in `src/lib/url.ts`.
The site therefore works both as an organization site (`<owner>.github.io`, base
`/`) and as a project site (base `/<repository>/`), as it is published here.

## Consequences

- No server, database or client-side JavaScript; the pages are plain HTML and CSS.
- Contributors need Node.js and npm; `mise install` and `mise run install` provide
  them. Dependency updates are deliberate changes to `package.json` and the lockfile.
- The daisyUI theme is defined in `src/waldstatt/theme.css`, and the stylesheet
  enables no built-in theme; a `data-theme` that names another theme silently
  falls back to the default.
- GitHub Pages needs a public repository on the organization's free plan.

## The tell

- `mise run check` passes: Prettier, `astro check`, and `astro build`.
- `rg -n 'href="/' src` finds no internal links that bypass `href()`; such links
  break when the site is served below a base path.
- The Node.js version in `.mise/config.toml` satisfies `engines.node` of `astro`
  in `package-lock.json`; review both when updating either.
