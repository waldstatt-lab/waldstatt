import { describe, expect, it } from "vitest";
import { fieldKind, gameQueries, type FieldFacts } from "./queries";

const none: FieldFacts = {
  known: true,
  building: false,
  lake: false,
  river: false,
  tree: false,
  seedling: false,
};

describe("field-at", () => {
  it("says what a field holds, the first that holds", () => {
    expect(fieldKind(none)).toBe("grass");
    expect(fieldKind({ ...none, seedling: true })).toBe("seedling");
    expect(fieldKind({ ...none, tree: true, seedling: true })).toBe("tree");
    expect(fieldKind({ ...none, river: true })).toBe("river");
    // The Sihlsee over a river is a lake.
    expect(fieldKind({ ...none, river: true, lake: true })).toBe("lake");
    // A building comes before what lies under it.
    expect(fieldKind({ ...none, building: true, river: true })).toBe(
      "building",
    );
    expect(fieldKind({ ...none, known: false, tree: true })).toBe("unknown");
  });

  it("takes two values, as marked-at", () => {
    expect(gameQueries["field-at"].args).toEqual([2, 2]);
    expect(gameQueries["marked-at"].args).toEqual([2, 2]);
  });
});
