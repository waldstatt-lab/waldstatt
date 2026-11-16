# Working on Waldstatt Games

The website of Waldstatt Games, a hobby game studio, published at
<https://2raben.github.io/waldstatt/> from the repository `2raben/waldstatt`. It
links the games programmed at the Nationaler Zukunftstag, which are built and
deployed from their own repositories: Moto Devil
(<https://2raben.github.io/moto-devil/>, `2raben/moto-devil`) and Car Drive
(<https://2raben.github.io/carrrgh/>, `2raben/carrrgh`). "2raben" is a temporary
organization name. The site is static, built with Astro 7, Tailwind CSS 4 and
daisyUI 5. Use the versions pinned in `package.json` and `package-lock.json`.

## Start here

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[architecture documentation](docs/architecture/README.md) before changing code.
Consult the [architectural decision records (ADRs)](docs/architecture/decisions/README.md)
for significant choices and their rationale.

- `src/pages/`: the home page, the about page and a page per game.
- `src/waldstatt/`: the site's meta, layout, components, stylesheet and daisyUI
  theme.
- `src/content/games/` and `src/content.config.ts`: one German Markdown file per
  game and its schema.
- `src/lib/`: shared helpers, `getGames()` and `href()` for base-path links.
- `astro.config.mjs`, `package.json`, `.prettierrc.json`: build, dependencies,
  and formatting.
- `.mise/config.toml` and `.mise/tasks/`: pinned Node.js and the `install`, `dev`,
  `build`, `preview`, `check`, `fmt` and `agents:init-claude` tasks.
- `.github/workflows/`: CI on pull requests and GitHub Pages on `main`.
- [docs/pitches/](docs/pitches/README.md): bounded feature proposals and companion sketches.

## Agent files

`CLAUDE.md` is a symlink to `AGENTS.md`, created by `mise run agents:init-claude`;
the task also links `.claude/skills` to `.agents/skills` once that directory
exists. Edit the shared originals, not the links. Do not edit installed skills in
place; record their sources and hashes in `skills-lock.json` when adding them.

## Architecture and scope

Keep the site static: no server, no client-side framework, and JavaScript only
where a feature cannot work without it. Link to the games' deployments; do not copy
game builds or assets into this repository. Build only what an accepted pitch or a
concrete fix needs, and distinguish implemented behavior from ideas and pitches.

Write all site text in German with Swiss spelling ("ss", not "ß"). Describe the
games from their own repositories' documentation; do not invent features. Link
internal pages through `href()` so the site works under a base path.

Update architecture documentation alongside changes to structure or behavior.
Record lasting architectural choices with the
[ADR template](docs/architecture/decisions/_adr-template.md) and update the decision
index. Use proposed status for unimplemented decisions; preserve the rationale of
accepted records when amending or superseding them.

## Editing and validation

Follow nearby code and Prettier. Keep changes focused, preserve existing user
changes, and avoid unrelated formatting or dependency upgrades. Keep
`package-lock.json` committed, install with `mise run install` (`npm ci`), and do
not edit `dist/`, `.astro/` or `node_modules/`.

Follow the [contribution checks](CONTRIBUTING.md#setup-and-validation). For code or
content changes, run `mise run check`: Prettier, `astro check`, and `astro build`.
Verify visual changes in a browser with `mise run dev` or `mise run preview`, at
desktop and phone widths. Do not claim a successful build proves a page looks
right.

Documentation-only changes need source and relative-link checks plus
`git diff --check`, not a full build. Report actual checks, failures, and unavailable
coverage. Follow contribution rules for branches, Conventional Commits, and PRs.
