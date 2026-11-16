# Waldstatt Games

The website of Waldstatt Games, a hobby game studio. It links the games
programmed at the Nationaler Zukunftstag:

| Game | Play | Source |
| --- | --- | --- |
| Moto Devil: a stunt-bike game whose levels lie to you | <https://2raben.github.io/moto-devil/> | [2raben/moto-devil](https://github.com/2raben/moto-devil) |
| Car Drive: a three-lane arcade driver through traffic | <https://2raben.github.io/carrrgh/> | [2raben/carrrgh](https://github.com/2raben/carrrgh) |

The games are built and deployed from their own repositories; this site only
links to them. It has a home page, an about page and a page per game.

It is a static site built with [Astro](https://astro.build) and
[daisyUI](https://daisyui.com), in German, and published on GitHub Pages at
<https://2raben.github.io/waldstatt/>.

## Run it locally

With [mise](https://mise.jdx.dev):

```sh
mise install && mise run install
mise run dev    # http://localhost:4321
```

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): how to shape, build, and submit changes.
- [AGENTS.md](AGENTS.md): instructions for AI coding agents.
- [Architecture](docs/architecture/README.md) and [decisions](docs/architecture/decisions/README.md).
- [Pitches](docs/pitches/README.md): proposed and implemented features.
