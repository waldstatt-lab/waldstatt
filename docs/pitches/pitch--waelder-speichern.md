# Problem

The Waldstatt keeps exactly one forest: the one being played,
saved in IndexedDB ([ADR 0003](../architecture/decisions/0003-save-the-waldstatt-in-indexeddb.md)).
A settlement grows over hours, and it can be lost: the colony can die out, a
flood wave can take the valley, and «Neu beginnen» deletes everything. Visitors
cannot keep a settlement they are proud of while they try something risky, and
cannot start a second forest without losing the first.

The save also lives only in one browser. Browsers may clear a rarely visited
site's storage, Safari limits script-written storage for sites that are not
installed, and a visitor who changes computer or browser starts over.

The work succeeds when a visitor can:

- save the forest being played under a name, and later load it back in place of
  the one being played;
- keep several such forests, see when each was saved and how large it is, and
  delete those no longer wanted;
- download a forest as a file to their computer, and load such a file back,
  in the same or another browser;
- start anew without losing the forests saved under a name.

# Solution

- **«Wälder speichern und laden …» in the menu**, and `:wälder` in the command
  finder, open a dialog «Wälder». It has a name field with «Speichern», the list
  of saved forests, newest first, each with its name, the time it was saved, its
  Waldleute and buildings, and «Laden», «Herunterladen» and «Löschen»; below it
  «Diesen Wald herunterladen» and «Wald aus Datei …». The finder has the same
  actions as `wald:…` commands, such as `wald:speichern` and
  `wald:laden:<name>`; each opens the dialog, so what happens shows there.
- **Saved forests are snapshots**: the whole forest as the save holds it, the
  settlement, the people and every chunk. They live in a second IndexedDB
  database, `waldstatt-games-saves`, one record per name, so «Neu beginnen»,
  which deletes the database of the forest being played, leaves them alone.
  Saving under a name that exists asks before it overwrites.
- **Loading replaces the forest being played** after a confirmation that says
  it will be replaced. The snapshot is checked first; then the saved forest's
  records are replaced in one transaction, and the page reloads, so the game
  starts the loaded forest through the normal start. Other tabs let go of the
  database first, as they do for «Neu beginnen», so none writes its old forest
  back.
- **A file is the same snapshot as JSON**, with a format marker, the name and
  the time, and the chunks' bytes in base64. Its name is made from the forest's
  name and the day, such as `waldstatt-am-bach-2026-11-18.json`. A file that is
  read is added to the list under its name (numbered if the name is taken), and
  the dialog then offers to load it.
- Announcements and a line in the dialog say what happened: saved, loaded,
  deleted, or why not.

# Security

Saved forests and files are untrusted input. Other Pages sites of the
organization share the origin and could write the database, and a file can
come from anywhere. Both pass the same checks as the save before anything is
stored or replaced: the save's schema version and limits, chunk keys and byte
lengths, base64 that is well-formed and short, a file of at most 32 MB, and
names cleaned of control characters and cut to 60 characters. Names are set as
text, never as HTML. Loading checks first and writes in one transaction, so a
broken snapshot never replaces a good forest. Nothing is sent over the network:
files are made with a blob URL and read with the file picker.

# Rabbit Holes

- **Writing over the forest being played** while it keeps saving: the page
  stops saving before it replaces, and other tabs are made to let go by opening
  the database at a higher version, the way a reset deletes it.
- **Converting older formats**: files and saved forests carry the save's
  version; one of another version is refused, as a save of another version
  starts a new forest.
- **Storing the list apart from the snapshots** so that listing is cheap: a
  handful of forests reads fast enough at once; the list holds at most 200.

# No-Gos

- No cloud saves, accounts or sharing links.
- No automatic backups or versions of the forest being played.
- No renaming of saved forests: save again under another name.
- No change to the format of the save itself.
