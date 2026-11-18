# Pitches

A pitch shapes a substantial feature before it is built: the problem, a rough
solution, the risks, and what is deliberately left out. Small fixes and
documentation corrections do not need one. See
[CONTRIBUTING.md](../../CONTRIBUTING.md#shaping-work) for the workflow.

Save each pitch as `docs/pitches/pitch--<slug>.md`, and keep breadboards,
fat-marker sketches (for example Excalidraw files), and reference images beside it.

## Template

Copy this outline into a new pitch:

```markdown
# Problem

What is wrong or missing, and for whom? Describe the situation that makes this
worth doing now, without proposing the solution yet.

# Solution

The rough shape of the answer: the elements, how the user meets them, and how
they connect. Link breadboards or sketches kept beside this file. Stay at the
level of detail that leaves room for the implementation to decide.

# Security

Network, storage, external content, or untrusted input this introduces, and how
it is contained, or why no security concern applies.

# Rabbit Holes

Details that could swallow the work, and the decision that avoids each one.

# No-Gos

What this pitch explicitly does not include.
```

## Index

| Pitch | Status |
| --- | --- |
| [Ein Aufbauspiel im Wald](pitch--aufbauspiel-im-wald.md) | implemented |
| [Leben in der Waldstatt – food, people, faith and a forest that grows back](pitch--leben-in-der-waldstatt.md) | implemented |
| [Wälder speichern, laden und als Datei mitnehmen](pitch--waelder-speichern.md) | implemented |
| [Verfall und Reparatur – buildings wear, fall into ruins and are repaired](pitch--verfall-und-reparatur.md) | implemented |
| [Befehle und Tasten – every action a named command that keys bind to, and macros](pitch--befehle-und-tasten.md) | shaped |
