# Waldstatt

A building game in the browser, in an endless forest around Einsiedeln:
«Waldstatt» is the historical name for Einsiedeln, and its people were the
«Waldleute». Visitors fell trees, build, and find the studio's texts and games
hidden in the forest. Play it at <https://2raben.github.io/waldstatt/>.

The forest hides the games programmed at the Nationaler Zukunftstag, which are
built and deployed from their own repositories:

| Game | Play | Source |
| --- | --- | --- |
| Moto Devil: a stunt-bike game whose levels lie to you | <https://2raben.github.io/moto-devil/> | [2raben/moto-devil](https://github.com/2raben/moto-devil) |
| Car Drive: a three-lane arcade driver through traffic | <https://2raben.github.io/carrrgh/> | [2raben/carrrgh](https://github.com/2raben/carrrgh) |

It is a static site built with [Astro](https://astro.build),
[daisyUI](https://daisyui.com) and [PixiJS](https://pixijs.com), in German, and
published on GitHub Pages.

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
