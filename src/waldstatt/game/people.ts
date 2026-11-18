/**
 * The Waldleute's lives: they age, eat, have children and die. Food reaches
 * those within 1 km of a Viehhof or a Bäckerei, or at first of the fire in
 * the first clearing; the others walk back to eat (sim.ts). Who dies within
 * reach of a church or the Kloster with room in its graveyard gets a grave
 * there; elsewhere a tombstone stays where they died, and motivation drops.
 * Nobody is protected: a settlement can die out.
 */
import { balance, kinds } from "./config";
import type { Game, Worker } from "./sim";
import type { Building } from "./state";
import { hasBaseTree, isRiver, start } from "./world";

export interface Point {
  x: number;
  y: number;
}

/** Where the fire burns in the first clearing; laid by placeFire(). */
export const fire: Point = { x: start.x + 0.5, y: start.y + 0.5 };

/**
 * Lays the fire on dry, open ground in the first clearing, near the first
 * pair but not on their tile or the axe's. The Alp runs through the
 * clearing, so this waits for its water to be known.
 */
export function placeFire() {
  let best: Point | undefined;
  let bestD = Infinity;
  const dry = (x: number, y: number) => !isRiver(x, y) && !hasBaseTree(x, y);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const x = start.x + dx;
      const y = start.y + dy;
      if ((!dx && !dy) || (x === start.x - 1 && y === start.y)) continue;
      if (!dry(x, y)) continue;
      // Not right at the water's edge.
      let wet = 0;
      for (const [ex, ey] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (isRiver(x + ex, y + ey)) wet++;
      const d = Math.hypot(dx, dy) + wet * 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  if (!best) return;
  fire.x = best.x + 0.5;
  fire.y = best.y + 0.5;
}

const between = (range: readonly [number, number]) =>
  range[0] + Math.random() * (range[1] - range[0]);

export class People {
  private points: Point[] = [];
  private pointsClock = 0;

  constructor(private g: Game) {
    const s = g.state;
    // The first pair, by the fire, with a little food.
    if (!s.people.length && s.nextPerson === 1) {
      g.addPerson({ sex: "f", age: 18, x: start.x + 0.2, y: start.y + 0.6 });
      g.addPerson({ sex: "m", age: 20, x: start.x + 0.8, y: start.y + 0.4 });
      s.stock.meat = balance.startFood;
      s.seen.add("meat");
      s.seen.add("wood");
    }
    this.findPoints();
  }

  /** Beds in finished houses, and the fire's shelter. */
  beds(): number {
    let beds = balance.fireBeds;
    for (const b of this.g.state.buildings)
      if (b.state === "done") beds += kinds[b.kind].beds ?? 0;
    return beds;
  }

  hungry(): number {
    return this.g.workers.filter((w) => w.hunger >= balance.mealSeconds).length;
  }

  isChild(w: Worker): boolean {
    return w.age < balance.workingAge;
  }

  /** Where food is served: farms, bakeries, and the fire until the first. */
  private findPoints() {
    const points: Point[] = [];
    for (const b of this.g.state.buildings)
      if (b.state === "done" && kinds[b.kind].food)
        points.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    if (!points.length) points.push(fire);
    this.points = points;
  }

  /** The nearest place food is served, within reach or not. */
  nearestFood(x: number, y: number): Point | undefined {
    let best: Point | undefined;
    let bestD = Infinity;
    for (const p of this.points) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Whether food reaches a place. */
  fed(x: number, y: number): boolean {
    const p = this.nearestFood(x, y);
    return !!p && Math.hypot(p.x - x, p.y - y) <= balance.reach;
  }

  /** Whether a hungry Waldmensch should walk back to where food is served. */
  needsWalk(w: Worker): boolean {
    return (
      w.hunger >= balance.mealSeconds &&
      this.g.economy.food() > 0 &&
      !this.fed(w.x, w.y)
    );
  }

  /** A Waldmensch eats, if there is food; true if they did. */
  eat(w: Worker): boolean {
    if (!this.g.economy.meal()) return false;
    w.hunger = 0;
    return true;
  }

  step(dt: number) {
    const g = this.g;
    this.pointsClock -= dt;
    if (this.pointsClock <= 0) {
      this.pointsClock = 1;
      this.findPoints();
    }
    const people = g.workers;
    const crowded = people.length > this.beds();
    const years =
      (dt / balance.yearSeconds) * (crowded ? balance.crowdedAgeing : 1);
    const food = g.economy.food();
    const [from, to] = balance.fertile;
    const fertile = (w: Worker) => w.age >= from && w.age <= to;
    const fathers = people.some((w) => w.sex === "m" && fertile(w));
    const plenty = food >= Math.max(4, people.length * balance.birthFood);
    const beer = g.state.stock.beer >= 1;
    // Gloomy Waldleute have far fewer children.
    const fertility = g.mood.fertility();
    const dead: [Worker, "age" | "hunger"][] = [];
    const born: Worker[] = [];
    for (const w of people) {
      w.age += years;
      // Children eat less.
      w.hunger += dt * (w.age < balance.workingAge ? balance.childAppetite : 1);
      if (w.hunger >= balance.mealSeconds && this.fed(w.x, w.y)) this.eat(w);
      if (w.age >= w.life) dead.push([w, "age"]);
      else if (w.hunger >= balance.mealSeconds + balance.starveSeconds)
        dead.push([w, "hunger"]);
      else if (
        w.sex === "f" &&
        fertile(w) &&
        fathers &&
        plenty &&
        people.length + born.length < balance.maxPeople &&
        w.age - w.lastChild >= balance.birthPause / balance.yearSeconds &&
        Math.random() <
          (dt * fertility) /
            (balance.birthSeconds * (beer ? balance.birthBeer : 1))
      ) {
        w.lastChild = w.age;
        if (beer) g.state.stock.beer--;
        const home = this.home(w);
        born.push(
          g.addPerson({
            sex: Math.random() < 0.5 ? "f" : "m",
            age: 0,
            x: home.x,
            y: home.y,
          }),
        );
      }
    }
    for (const [w, cause] of dead) this.die(w, cause);
    if (born.length) {
      g.events.news(
        born.length === 1
          ? "Ein Kind ist geboren."
          : `${born.length} Kinder sind geboren.`,
      );
      g.events.supplies();
      g.events.dirty();
    }
  }

  /** Where a child is born: by the nearest house, or by its mother. */
  private home(mother: Worker): Point {
    let best: Point = { x: mother.x, y: mother.y };
    let bestD = Infinity;
    for (const b of this.g.state.buildings) {
      if (b.state !== "done" || !kinds[b.kind].beds) continue;
      const p = { x: b.x + b.w / 2, y: b.y + b.h + 0.3 };
      const d = Math.hypot(p.x - mother.x, p.y - mother.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return { x: best.x + (Math.random() - 0.5) * 0.6, y: best.y };
  }

  private die(w: Worker, cause: "age" | "hunger") {
    const g = this.g;
    g.removePerson(w);
    g.state.deaths[cause]++;
    const yard = this.graveyard(w.x, w.y);
    if (yard) {
      yard.graves = (yard.graves ?? 0) + 1;
      g.events.building(yard);
    } else {
      g.addTomb(Math.floor(w.x), Math.floor(w.y));
      g.mood.event("lonelyDeath");
    }
    const who = this.isChild(w) ? "Ein Kind" : "Ein Waldmensch";
    g.events.news(
      cause === "hunger" ? `${who} ist verhungert.` : `${who} ist gestorben.`,
    );
    if (!g.workers.length)
      g.events.news("Die Waldstatt ist verlassen. Niemand lebt mehr hier.");
    g.economy.syncCrews();
    g.events.supplies();
    g.events.dirty();
  }

  /**
   * A graveyard with room beside a church or the Kloster within reach of a
   * place; the nearest church first.
   */
  private graveyard(x: number, y: number): Building | undefined {
    const g = this.g;
    const holy = g.state.buildings
      .filter(
        (b) =>
          (b.kind === "kirche" || b.kind === "kloster") && b.state === "done",
      )
      .map((b) => ({
        b,
        d: Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y),
      }))
      .filter(({ d }) => d <= balance.reach)
      .sort((a, b) => a.d - b.d);
    for (const { b: church } of holy) {
      const yard = g.state.buildings.find(
        (b) =>
          b.kind === "friedhof" &&
          b.state === "done" &&
          (b.graves ?? 0) < balance.graves &&
          g.touching(b, church),
      );
      if (yard) return yard;
    }
    return undefined;
  }
}

/** A new life: when it will end of age. */
export function lifespan(): number {
  return between(balance.lifeYears);
}
