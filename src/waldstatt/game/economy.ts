/**
 * The goods: the shared stock and its limits, the producing buildings and
 * their crews, beer for the Spielhäuser and the theatre, the upkeep of the
 * Klause, the churches and the Kloster, and the Brot auswerfen. Goods are not
 * carried: what a building makes is in stock at once.
 */
import {
  balance,
  crewKinds,
  foods,
  goodMax,
  goodName,
  recipes,
  type Cost,
  type Good,
} from "./config";
import type { Game, Worker } from "./sim";
import type { Building } from "./state";

const entries = (c: Cost) =>
  Object.entries(c).filter(([, n]) => (n ?? 0) > 0) as [Good, number][];

export class Economy {
  /** Seconds of work towards each building's next round. */
  private clocks = new Map<number, number>();
  private upkeepClock = 0;
  private crewClock = 0;

  constructor(private g: Game) {}

  // --- The stock --------------------------------------------------------------

  has(cost: Cost): boolean {
    return entries(cost).every(([key, n]) => this.g.state.stock[key] >= n);
  }

  /** What is missing of a cost, such as «4 Steine, 2 Bücher». */
  missing(cost: Cost): string {
    return entries(cost)
      .map(([key, n]) => [key, n - this.g.state.stock[key]] as const)
      .filter(([, lack]) => lack > 0)
      .map(([key, lack]) => `${lack} ${goodName(key)}`)
      .join(", ");
  }

  pay(cost: Cost) {
    for (const [key, n] of entries(cost)) this.g.state.stock[key] -= n;
    this.g.events.supplies();
  }

  /** Adds goods up to their limits; returns whether anything was added. */
  gain(key: Good, n: number): boolean {
    const s = this.g.state;
    const before = s.stock[key];
    s.stock[key] = Math.min(goodMax(key), before + n);
    if (s.stock[key] === before) return false;
    if (!s.seen.has(key)) {
      s.seen.add(key);
      this.g.events.goods();
    }
    this.g.events.supplies();
    return true;
  }

  food(): number {
    return foods.reduce((sum, key) => sum + this.g.state.stock[key], 0);
  }

  /** Takes one meal, of whichever food there is more; false if none. */
  meal(): boolean {
    const s = this.g.state.stock;
    const key = s.bread >= s.meat ? "bread" : "meat";
    if (s[key] < 1) return false;
    s[key]--;
    if (this.food() === 0)
      this.g.events.news("Es ist nichts mehr zu essen da.");
    this.g.events.supplies();
    return true;
  }

  // --- Crews ---------------------------------------------------------------------

  /** Waldleute who can work: children cannot. */
  private adults(): Worker[] {
    return this.g.workers.filter((w) => w.age >= balance.workingAge);
  }

  /**
   * Gives every finished producing building the Waldleute it asks for, as
   * far as there are any, keeping one free to fell and build: idle ones and
   * those nearest first. The others go back to work.
   */
  syncCrews() {
    const g = this.g;
    const workshops = g.state.buildings.filter(
      (b) => crewKinds.includes(b.kind) && b.state === "done",
    );
    for (const w of g.workers)
      if (
        w.job &&
        (!workshops.some((q) => q.id === w.job) || w.age < balance.workingAge)
      ) {
        w.job = undefined;
        g.idle(w);
      }
    const adults = this.adults();
    let free = adults.filter((w) => !w.job).length;
    const keep = adults.length >= 2 ? 1 : 0;
    for (const q of workshops) {
      const crew = g.workers.filter((w) => w.job === q.id);
      const want = Math.min(q.crew ?? 0, balance.maxCrew);
      while (crew.length > want) {
        const w = crew.pop() as Worker;
        w.job = undefined;
        g.idle(w);
        free++;
      }
      while (crew.length < want && free > keep) {
        const candidates = adults.filter((w) => !w.job && w.phase !== "sail");
        if (!candidates.length) break;
        const cx = q.x + q.w / 2;
        const cy = q.y + q.h / 2;
        candidates.sort(
          (a, b) =>
            Number(!!a.task) - Number(!!b.task) ||
            Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
        );
        const w = candidates[0];
        w.job = q.id;
        g.idle(w);
        crew.push(w);
        free--;
      }
    }
  }

  crewOf(b: Building): number {
    return this.g.workers.filter((w) => w.job === b.id).length;
  }

  /** Waldleute of a building at work there now. */
  private atWork(b: Building): number {
    return this.g.workers.filter(
      (w) =>
        w.job === b.id &&
        w.task?.type === "workshop" &&
        w.task.id === b.id &&
        w.phase === "work",
    ).length;
  }

  // --- The round of work -----------------------------------------------------------

  step(dt: number) {
    const g = this.g;
    // Children come of age and Waldleute become free: crews fill up.
    this.crewClock -= dt;
    if (this.crewClock <= 0) {
      this.crewClock = 1;
      this.syncCrews();
    }
    const speed = g.mood.speed();
    for (const b of g.state.buildings) {
      if (b.state !== "done") continue;
      const recipe = recipes[b.kind];
      if (recipe) this.produce(b, recipe, dt * speed);
      if (b.kind === "spielhaus" || b.kind === "theater") this.drink(b, dt);
      if (b.kind === "brot") this.throwBread(b, dt);
    }
    this.upkeepClock += dt;
    if (this.upkeepClock >= balance.upkeepSeconds) {
      this.upkeepClock -= balance.upkeepSeconds;
      this.upkeep();
    }
  }

  private produce(
    b: Building,
    recipe: NonNullable<(typeof recipes)[keyof typeof recipes]>,
    work: number,
  ) {
    const n = this.atWork(b);
    const full = entries(recipe.makes).every(
      ([key]) => this.g.state.stock[key] >= goodMax(key),
    );
    if (!n || full || !this.has(recipe.takes)) {
      this.clocks.set(b.id, 0);
      return;
    }
    let clock = (this.clocks.get(b.id) ?? 0) + work * n;
    if (clock >= recipe.seconds) {
      clock -= recipe.seconds;
      for (const [key, k] of entries(recipe.takes))
        this.g.state.stock[key] -= k;
      for (const [key, k] of entries(recipe.makes)) this.gain(key, k);
      // New stones may let paving go on.
      this.g.opened();
      this.g.events.dirty();
    }
    this.clocks.set(b.id, clock);
  }

  /** A Spielhaus or the theatre drinks beer; without, it is shut. */
  private drink(b: Building, dt: number) {
    let clock = (this.clocks.get(b.id) ?? balance.beerSeconds) + dt;
    if (clock >= balance.beerSeconds) {
      const s = this.g.state.stock;
      const had = !!b.beer;
      if (s.beer >= 1) {
        s.beer--;
        b.beer = true;
        clock = 0;
        this.g.events.supplies();
      } else {
        b.beer = undefined;
        // Look again soon for new beer.
        clock = balance.beerSeconds - 2;
      }
      if (had !== !!b.beer) {
        this.g.events.building(b);
        if (!b.beer) this.g.events.news(`${this.g.nameOf(b)}: kein Bier mehr.`);
      }
    }
    this.clocks.set(b.id, clock);
  }

  /** Whether a Spielhaus or the theatre may be used. */
  open(b: Building): boolean {
    return b.state === "done" && !!b.beer;
  }

  private throwBread(b: Building, dt: number) {
    const g = this.g;
    const s = g.state.stock;
    const thrown = b.thrown ?? 0;
    // It begins only with all the bread there.
    if (!thrown && s.bread < balance.brotLoaves) return;
    let clock = (this.clocks.get(b.id) ?? 0) + dt;
    while (clock >= balance.brotSeconds && s.bread >= 1) {
      clock -= balance.brotSeconds;
      s.bread--;
      b.thrown = (b.thrown ?? 0) + 1;
      g.mood.event("brot");
      if (b.thrown === 1) g.events.news("Brot auswerfen: Das Brot fliegt!");
      // The hungriest within reach catches it.
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const near = g.workers
        .filter((w) => Math.hypot(w.x - cx, w.y - cy) <= balance.brotCatch)
        .sort((a, c) => c.hunger - a.hunger)[0];
      if (near) near.hunger = 0;
      g.events.supplies();
      if (b.thrown >= balance.brotLoaves) {
        g.removeBuilding(b);
        g.events.news("Alles Brot ist ausgeworfen. Die Bühne wird abgebaut.");
        return;
      }
    }
    this.clocks.set(b.id, clock);
  }

  /** The Klause, churches and the Kloster take food and books, or decay. */
  private upkeep() {
    const g = this.g;
    const foodMade = g.done("viehhof") || g.done("baeckerei");
    const booksMade = g.done("druckerei");
    for (const b of g.state.buildings) {
      const need = g.info(b).upkeep;
      if (!need || b.state !== "done") continue;
      const food = foodMade ? need.food : 0;
      const books = booksMade ? need.books : 0;
      const before = b.condition ?? 1;
      let supplied = this.food() >= food && g.state.stock.books >= books;
      if (supplied) {
        for (let i = 0; i < food; i++) supplied = this.meal() && supplied;
        g.state.stock.books -= books;
      }
      b.condition = Math.max(
        0,
        Math.min(1, before + (supplied ? balance.mend : -balance.decay)),
      );
      const crossed =
        before >= balance.working !== b.condition >= balance.working;
      if (b.condition <= 0) {
        b.state = "ruin";
        g.lost(b);
        g.events.news(`${g.nameOf(b)} ist verfallen.`);
      } else if (crossed) {
        g.events.news(
          b.condition >= balance.working
            ? `${g.nameOf(b)} ist wieder in gutem Zustand.`
            : `${g.nameOf(b)} verfällt.`,
        );
        g.syncRavens();
      }
      g.events.building(b);
    }
    g.events.supplies();
    g.events.dirty();
  }
}
