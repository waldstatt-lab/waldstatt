import { describe, expect, it } from "vitest";
import { balance, durability, kinds, type Kind } from "./config";
import type { Game } from "./sim";
import type { Building } from "./state";
import {
  most,
  points,
  repairCost,
  salvage,
  share,
  Wear,
  wearLevel,
  wears,
} from "./wear";

let nextId = 1;

function building(kind: Kind, more: Partial<Building> = {}): Building {
  return {
    id: nextId++,
    kind,
    x: 0,
    y: 0,
    w: kinds[kind].w,
    h: kinds[kind].h,
    state: "done",
    work: 0,
    ...more,
  };
}

/** The part of the game wear touches, writing down what it is told. */
function game(...buildings: Building[]) {
  const g = {
    news: [] as string[],
    lost: [] as Building[],
    shown: [] as Building[],
    ravens: 0,
    opened: 0,
    broken: 0,
  };
  const fake = {
    state: { buildings },
    events: {
      news: (text: string) => g.news.push(text),
      building: (b: Building) => g.shown.push(b),
      dirty: () => undefined,
    },
    nameOf: (b: Building) => kinds[b.kind].name,
    opened: () => g.opened++,
    syncRavens: () => g.ravens++,
    lost: (b: Building) => g.lost.push(b),
    flood: { breakDam: () => g.broken++ },
  };
  return { g, wear: new Wear(fake as unknown as Game) };
}

describe("how long a building lasts", () => {
  it("follows what it is made of and how large it is", () => {
    const at = (kind: Kind) => durability(kind, 2, 2);
    expect(at("getreidehof")).toBe(balance.durability.farm);
    expect(at("huette")).toBe(balance.durability.wood);
    expect(at("muehle")).toBe(balance.durability.mixed);
    expect(at("steinhaus")).toBe(balance.durability.stone);
    expect(durability("huette", 4, 4)).toBe(2 * balance.durability.wood);
    expect(durability("huette", 1, 1)).toBeGreaterThanOrEqual(1);
    expect(most(building("kloster"))).toBeGreaterThan(
      most(building("steinhaus")),
    );
  });

  it("is nothing for what is made of nothing, which does not wear", () => {
    const kind = (Object.keys(kinds) as Kind[]).find((k) => !kinds[k].material);
    expect(kind).toBeDefined();
    const b = building(kind as Kind);
    expect(most(b)).toBe(0);
    expect(wears(b)).toBe(false);
    expect(wearLevel(b)).toBe(0);
    expect(wears(building("huette", { state: "site" }))).toBe(false);
    expect(wears(building("huette"))).toBe(true);
  });

  it("counts its condition in whole points, up, past rounding noise", () => {
    const b = building("huette");
    const n = most(b);
    expect(points(b)).toBe(n);
    b.condition = 0.5;
    expect(points(b)).toBe(Math.ceil(n / 2));
    // Three points left, as wear arrives at them: not four.
    b.condition = 1 - (n - 3) / n;
    expect(points(b)).toBe(3);
    b.condition = 2.5 / n;
    expect(points(b)).toBe(3);
    b.condition = 0;
    expect(points(b)).toBe(0);
  });

  it("looks sound, worn, crumbling or in ruins by its share left", () => {
    const b = building("huette");
    expect(wearLevel(b)).toBe(0);
    b.condition = 2 / 3;
    expect(wearLevel(b)).toBe(0);
    b.condition = 0.66;
    expect(wearLevel(b)).toBe(1);
    b.condition = 1 / 3;
    expect(wearLevel(b)).toBe(1);
    b.condition = 0.33;
    expect(wearLevel(b)).toBe(2);
    expect(wearLevel({ ...b, state: "ruin" })).toBe(3);
    expect(wearLevel({ ...b, state: "site" })).toBe(0);
  });
});

describe("wear", () => {
  it("takes a point a year, counted once a second", () => {
    const b = building("huette");
    const { wear } = game(b);
    wear.step(0.5);
    expect(share(b)).toBe(1);
    wear.step(0.5);
    expect(share(b)).toBeCloseTo(1 - 1 / (most(b) * balance.wearSeconds));
    for (let t = 1; t < balance.wearSeconds; t++) wear.step(1);
    expect(points(b)).toBe(most(b) - 1);
  });

  it("leaves what is not finished alone", () => {
    const site = building("huette", { state: "site" });
    const ruin = building("huette", { state: "ruin", condition: 0 });
    const { wear } = game(site, ruin);
    wear.step(1000);
    wear.damage(site, 0.5);
    wear.mend(ruin, 1);
    expect(site.condition).toBeUndefined();
    expect(ruin).toMatchObject({ state: "ruin", condition: 0 });
  });

  it("tells when a building becomes crumbling, unless it is repaired", () => {
    const b = building("huette");
    const other = building("huette", { repair: true });
    const { g, wear } = game(b, other);
    wear.damage(b, 0.5);
    expect(g.news).toEqual([]);
    expect(g.shown).toEqual([b]);
    wear.damage(b, 0.2);
    expect(g.news).toEqual(["Hütte ist baufällig."]);
    wear.damage(other, 0.7);
    expect(g.news).toHaveLength(1);
  });

  it("falls into ruins at none left, and nobody works in it any more", () => {
    const b = building("huette", { condition: 0.1, repair: true });
    const { g, wear } = game(b);
    wear.damage(b, 0.5);
    expect(b).toMatchObject({ state: "ruin", condition: 0, repair: undefined });
    expect(g.lost).toEqual([b]);
    expect(g.news).toEqual(["Hütte ist eingestürzt."]);
    expect(g.broken).toBe(0);
  });

  it("breaks a worn-out dam", () => {
    const dam = building("damm", { condition: 0.01 });
    const { g, wear } = game(dam);
    wear.damage(dam, 0.01);
    expect(dam.state).toBe("ruin");
    expect(g.broken).toBe(1);
    expect(g.news).toEqual(["Der Damm ist gebrochen!"]);
  });

  it("takes an upkeep building's effect below half and gives it back", () => {
    const b = building("kloster");
    const { g, wear } = game(b);
    wear.damage(b, 1 - balance.working - 0.01);
    expect(g.ravens).toBe(0);
    wear.damage(b, 0.02);
    expect(g.ravens).toBe(1);
    expect(g.news).toContain("Kloster Einsiedeln verfällt.");
    wear.mend(b, 0.02);
    expect(g.ravens).toBe(2);
    expect(g.news).toContain("Kloster Einsiedeln ist wieder in gutem Zustand.");
  });

  it("ends a repair once the building is sound again", () => {
    const b = building("huette", { condition: 0.4, repair: true });
    const { g, wear } = game(b);
    wear.mend(b, 0.3);
    expect(b.repair).toBe(true);
    expect(g.opened).toBe(0);
    wear.mend(b, 0.5);
    expect(b).toMatchObject({ condition: 1, repair: undefined });
    expect(g.opened).toBe(1);
    expect(g.news).toContain("Hütte ist repariert.");
  });
});

describe("what wear costs", () => {
  it("takes part of the costs for a repair, as far as worn, rounded up", () => {
    const b = building("steinhaus");
    const cost = kinds.steinhaus.cost;
    expect(repairCost(b)).toEqual({});
    b.condition = 0.5;
    expect(repairCost(b)).toEqual({
      wood: Math.ceil((cost.wood ?? 0) * balance.repair * 0.5),
      stones: Math.ceil((cost.stones ?? 0) * balance.repair * 0.5),
    });
    // A little wear costs a little of each, never nothing.
    b.condition = 0.999;
    expect(repairCost(b)).toEqual({ wood: 1, stones: 1 });
    expect(repairCost({ ...b, state: "ruin" })).toEqual({});
    expect(repairCost({ ...b, state: "site" })).toEqual({});
  });

  it("gives part of the costs back as far as not worn, rounded down", () => {
    const b = building("steinhaus");
    const cost = kinds.steinhaus.cost;
    expect(salvage(b)).toEqual({
      wood: Math.floor((cost.wood ?? 0) * balance.refund),
      stones: Math.floor((cost.stones ?? 0) * balance.refund),
    });
    b.condition = 0.5;
    expect(salvage(b)).toEqual({
      wood: Math.floor((cost.wood ?? 0) * balance.refund * 0.5),
      stones: Math.floor((cost.stones ?? 0) * balance.refund * 0.5),
    });
    b.condition = 0.01;
    expect(salvage(b)).toEqual({});
  });
});
