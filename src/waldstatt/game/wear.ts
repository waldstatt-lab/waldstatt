/**
 * Wear: every finished building loses a point of condition a year of play,
 * whatever it is. How many points it has when new follows what it is made
 * of and how large it is (`durability()`): fields and pens last a few years,
 * huts some more, stone halls and the Kloster longest. At none left it falls
 * into ruins and does nothing more: no beds, no work, no way across; a
 * worn-out dam breaks and sends the flood wave down the Sihl. Waldleute
 * repair what is paid for. Ruins cannot be repaired: within reach of a
 * Recyclinghof they are cleared away with much work. The condition is saved
 * as a share of the most, so a change of balance keeps how worn each
 * building looks.
 */
import { balance, durability, goodKeys, kinds, type Cost } from "./config";
import type { Game } from "./sim";
import type { Building } from "./state";

/** How worn a building looks: 0 sound, 1 worn, 2 crumbling, 3 in ruins. */
export type WearLevel = 0 | 1 | 2 | 3;

export const wearNames = ["gut", "abgenutzt", "baufällig", "zerfallen"];

/** The share of its condition a building has left, 0 to 1. */
export const share = (b: Building) => b.condition ?? 1;

/** A building's most condition, in points: years of play it lasts. */
export const most = (b: Pick<Building, "kind" | "w" | "h">) =>
  durability(b.kind, b.w, b.h);

/** Its condition in points, as the card and the finder count it. */
export const points = (b: Building) =>
  Math.max(0, Math.ceil(share(b) * most(b) - 1e-9));

/** Whether a building wears at all: finished, and made of something. */
export const wears = (b: Building) => b.state === "done" && most(b) > 0;

export function wearLevel(b: Building): WearLevel {
  if (b.state === "ruin") return 3;
  if (b.state !== "done" || !most(b)) return 0;
  const k = share(b);
  return k >= 2 / 3 ? 0 : k >= 1 / 3 ? 1 : 2;
}

/**
 * What a repair takes: part of the building's costs as far as it is worn,
 * rounded up. A ruin or a building not finished is not repaired.
 */
export function repairCost(b: Building): Cost {
  if (b.state !== "done") return {};
  const worn = Math.max(0, 1 - share(b));
  const out: Cost = {};
  if (worn <= 0) return out;
  for (const key of goodKeys) {
    const n = Math.ceil((kinds[b.kind].cost[key] ?? 0) * balance.repair * worn);
    if (n > 0) out[key] = n;
  }
  return out;
}

/**
 * What a building torn down within reach of a Recyclinghof gives back: part
 * of its costs as far as it is not worn, rounded down.
 */
export function salvage(b: Building): Cost {
  const k = balance.refund * share(b);
  const out: Cost = {};
  for (const key of goodKeys) {
    const n = Math.floor((kinds[b.kind].cost[key] ?? 0) * k);
    if (n > 0) out[key] = n;
  }
  return out;
}

export class Wear {
  private clock = 0;

  constructor(private g: Game) {}

  /** Wears every finished building down, once a second. */
  step(dt: number) {
    this.clock += dt;
    if (this.clock < 1) return;
    const elapsed = this.clock;
    this.clock = 0;
    for (const b of [...this.g.state.buildings]) {
      if (!wears(b)) continue;
      this.set(b, share(b) - elapsed / (most(b) * balance.wearSeconds));
    }
  }

  /** Takes a share of its condition from a building, as decay does. */
  damage(b: Building, by: number) {
    if (wears(b)) this.set(b, share(b) - by);
  }

  /** Waldleute repair: a share of its condition comes back. */
  mend(b: Building, by: number) {
    if (b.state !== "done") return;
    this.set(b, share(b) + by);
    if (share(b) < 1) return;
    b.repair = undefined;
    this.g.opened();
    this.g.events.news(`${this.g.nameOf(b)} ist repariert.`);
    this.g.events.building(b);
    this.g.events.dirty();
  }

  /**
   * Sets a finished building's condition, and what follows: it looks worse
   * or better, the Klause, churches and the Kloster lose or regain their
   * effect at half, and at none it falls into ruins.
   */
  private set(b: Building, value: number) {
    const g = this.g;
    const before = share(b);
    const level = wearLevel(b);
    b.condition = Math.max(0, Math.min(1, value));
    if (b.condition <= 0) return this.collapse(b);
    if (kinds[b.kind].upkeep) {
      const working = balance.working;
      if (before >= working !== b.condition >= working) {
        g.events.news(
          b.condition >= working
            ? `${g.nameOf(b)} ist wieder in gutem Zustand.`
            : `${g.nameOf(b)} verfällt.`,
        );
        g.syncRavens();
      }
    }
    if (wearLevel(b) !== level) {
      if (wearLevel(b) === 2 && !b.repair)
        g.events.news(`${g.nameOf(b)} ist baufällig.`);
      g.events.building(b);
      g.events.dirty();
    }
  }

  /** Worn out: the building falls into ruins; a dam breaks. */
  private collapse(b: Building) {
    const g = this.g;
    b.state = "ruin";
    b.condition = 0;
    b.repair = undefined;
    g.lost(b);
    if (b.kind === "damm") {
      g.events.news("Der Damm ist gebrochen!");
      g.flood.breakDam();
    } else g.events.news(`${g.nameOf(b)} ist eingestürzt.`);
  }
}
