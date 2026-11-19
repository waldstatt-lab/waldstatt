/**
 * The help texts written from the keymap (keymap.ts): the map's description
 * for screen readers and the key list in the menu, again after each change.
 */
import { need } from "./dom";
import { keyLabel, keysFor, keySpoken } from "./keymap";

/**
 * Writes the keys into the map's description for screen readers and into
 * the menu's list, from the keymap, again after each change.
 */
export function describeKeys(root: HTMLElement) {
  const said = (command: string) =>
    keysFor(command).map(keySpoken).join(" oder ") || "keine Taste";
  need(root, "[data-map-help]").textContent = [
    `${said("left")}, ${said("right")}, ${said("up")} und ${said("down")} bewegen die Auswahl nach links, rechts, oben und unten; Ziffern davor bewegen so viele Felder weit, mit Umschalt verschieben sie die Karte.`,
    `${said("zoom:in")} und ${said("zoom:out")} zoomen.`,
    `${said("enter")} wendet das Werkzeug an oder tippt an, was unter der Auswahl liegt; ${said("selection:start")} beginnt ein Rechteck für Holzhacken mit der Säge oder Pflaster, ${said("selection:other")} springt zu seiner anderen Ecke.`,
    `${said("tool:holzhacken")}, ${said("tool:pflastern")}, ${said("tool:reparieren")} und ${said("tool:abreissen")} wählen Holzhacken, Pflastern, Reparieren und Abreissen, ${said("menu:build")} öffnet Bauen, ${said("menu:main")} das Menü, ${said("find:texts")} springt zum Start oder zu gefundenen Schriften, ${said("find:commands")} öffnet Befehle.`,
    `${said("macro:record")} nimmt ein Makro auf und beendet die Aufnahme, ${said("macro:replay")} spielt das letzte ab; Ziffern davor so oft.`,
    `Liest du eine Schrift von oben, macht ${said("enter")} auf ihr die Auswahl zum Textcursor, bis Escape: ${said("text:left")}, ${said("text:right")}, ${said("text:up")} und ${said("text:down")} bewegen ihn um Zeichen und Zeilen, ${said("text:word-next")}, ${said("text:word-back")} und ${said("text:word-end")} um Wörter, ${said("text:start")} zum Anfang, ${said("text:end")} zur letzten Zeile, Ziffern davor so oft; ${said("text:select")} wählt Zeichen aus, ${said("text:select-line")} Zeilen, ${said("text:other")} springt zum anderen Ende, ${said("text:copy")} kopiert.`,
    `Auf der Karte eines Gebäudes repariert ${said("card:repair")} es; auf der Karte einer Werkstatt geben ${said("crew:more")} einen Waldmenschen mehr hinein und ${said("crew:less")} einen weniger.`,
    "Escape bricht ab. Im Menü unter «Tasten» lassen sich die Tasten und Makros ändern.",
  ].join(" ");
  const keys = (command: string) => keysFor(command).map(keyLabel).join(" ");
  const list = (pairs: [string, string][]) =>
    pairs.filter(([c]) => keysFor(c).length).map(([c, n]) => `${keys(c)} ${n}`);
  const moves = ["left", "right", "up", "down"].map(keys).filter(Boolean);
  need(root, "[data-keys-help]").textContent = [
    ...(moves.length
      ? [`${moves.join(", ")} bewegen, Ziffern davor so weit`]
      : []),
    ...list([
      ["selection:start", "Auswahl"],
      ["selection:other", "andere Ecke"],
      ["tool:holzhacken", "Holzhacken"],
      ["tool:pflastern", "Pflastern"],
      ["tool:reparieren", "Reparieren"],
      ["tool:abreissen", "Abreissen"],
      ["menu:build", "Bauen"],
      ["menu:main", "Menü"],
      ["find:texts", "Start und Schriften"],
      ["find:commands", "Befehle"],
      ["macro:record", "Makro aufnehmen"],
      ["macro:replay", "Makro abspielen"],
    ]),
    `im Text: ${[
      "text:left",
      "text:down",
      "text:up",
      "text:right",
      "text:word-next",
      "text:word-back",
      "text:word-end",
      "text:start",
      "text:end",
      "text:select",
      "text:select-line",
      "text:other",
      "text:copy",
    ]
      // Letters first, as «h» before «←», and «g g» as «gg».
      .map((c) => {
        const all = keysFor(c);
        const letters = all.find((k) => k.every((x) => [...x].length === 1));
        return (letters ?? all[0])?.join("") ?? "";
      })
      .filter(Boolean)
      .join(" ")}`,
    `auf der Karte eines Gebäudes: ${list([
      ["card:repair", "reparieren"],
      ["crew:more", "mehr"],
      ["crew:less", "weniger Waldleute"],
    ]).join(", ")}`,
  ]
    .join(" · ")
    .replace(/^/, "Tasten: ");
}
