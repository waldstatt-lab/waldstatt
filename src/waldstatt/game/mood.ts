/**
 * Motivation, «Stimmung»: one value for the whole settlement that sets how
 * fast everybody fells, builds and works. It drifts towards a level set by
 * what stands and how the Waldleute live, and events push it up or down for
 * a while.
 */
import { balance } from "./config";
import type { Game } from "./sim";

export type MoodEventName = keyof typeof balance.moodEvents;

export class Mood {
  constructor(private g: Game) {}

  /** How fast work goes now: 1 is normal. */
  speed(): number {
    const [lo, hi] = balance.moodSpeed;
    return lo + ((hi - lo) * this.g.state.mood) / 100;
  }

  /**
   * How often children come now: 1 at the base motivation, falling steeply
   * below it to none at 0 percent, rising gently above it.
   */
  fertility(): number {
    const mood = this.g.state.mood;
    const base = balance.moodBase;
    const { power, max } = balance.moodBirths;
    if (mood <= base) return (mood / base) ** power;
    return 1 + ((max - 1) * (mood - base)) / (100 - base);
  }

  /** Pushes motivation for a while; the same event again starts it anew. */
  event(name: MoodEventName) {
    const [amount, seconds] = balance.moodEvents[name];
    const same = this.g.state.moods.find(
      (m) => m.amount === amount && m.total === seconds,
    );
    if (same && amount > 0) same.left = seconds;
    else this.g.state.moods.push({ amount, left: seconds, total: seconds });
  }

  /** Where motivation tends with what stands and how the Waldleute live. */
  private level(): number {
    const g = this.g;
    const m = balance.mood;
    const working = (kind: "kirche" | "kloster") =>
      g.state.buildings.filter(
        (b) =>
          b.kind === kind &&
          b.state === "done" &&
          (b.condition ?? 1) >= balance.working,
      ).length;
    let level = balance.moodBase;
    level += Math.min(m.churches, working("kirche")) * m.kirche;
    if (working("kloster")) level += m.kloster;
    if (g.done("ise")) level += m.ise;
    for (const b of g.state.buildings)
      if (b.kind === "spielhaus" && b.state === "done")
        level += b.beer ? m.beer : m.dry;
    const people = g.workers.length;
    if (people) {
      const beds = g.people.beds();
      if (people > beds)
        level += m.crowded * Math.min(1, (people - beds) / Math.max(beds, 2));
      level += m.hungry * (g.people.hungry() / people);
    }
    return level;
  }

  step(dt: number) {
    const s = this.g.state;
    let passing = 0;
    for (const m of s.moods) {
      m.left = Math.max(0, m.left - dt);
      passing += (m.amount * m.left) / m.total;
    }
    s.moods = s.moods.filter((m) => m.left > 0);
    // Many events at once count only so far.
    passing = Math.max(-40, Math.min(40, passing));
    const want = Math.max(0, Math.min(100, this.level() + passing));
    s.mood += (want - s.mood) * Math.min(1, dt / balance.moodDrift);
  }
}
