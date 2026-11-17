/**
 * Car Drive's preview in the theatre: three lanes from above on a painted
 * meadow, with traffic both ways, cars that blink before changing lanes,
 * levels every 1000 m, trucks from 4000 m, hearts, a shield, coins and the
 * boost gauge. The rules are copied from the studio website's preview; the
 * scenery is repainted.
 */
import { clamp, glow, type Game, type Report } from "./preview";

const W = 200;
const H = 110;
const road = { x: 76, width: 48, lane: 16 };
/** The top of the player's car. */
const playerY = 84;
const laneCenter = (n: number) => road.x + n * road.lane + road.lane / 2;
const car = { w: 9, h: 14 };
const truck = { w: 11, h: 25 };

/** Scroll speed in units per second, and metres per unit. */
const cruise = 46;
const boostFactor = 1.7;
const metresPerUnit = 5.4;

const keys: Record<string, string> = {
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
  " ": "boost",
  r: "restart",
};
const colors = ["#2a62b8", "#8a4fb0", "#e0a030", "#3f8a4a"];
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

interface Vehicle {
  lane: number;
  x: number;
  y: number;
  /** 1 drives your way, -1 comes towards you. */
  dir: number;
  speed: number;
  truck: boolean;
  color: string;
  blink: number;
  target: number;
}

export function carGame(report: Report): Game {
  const s = {
    lane: 1,
    x: laneCenter(1),
    scroll: 0,
    metres: 0,
    hearts: 3,
    hurt: 0,
    shield: 0,
    gauge: 1,
    boosting: false,
    over: false,
    pickup: { kind: "heart", lane: 0, y: 999 },
    time: 0,
  };
  const vehicles: Vehicle[] = Array.from({ length: 6 }, () => ({
    lane: 0,
    x: 0,
    y: 999,
    dir: 1,
    speed: 0,
    truck: false,
    color: colors[0],
    blink: 0,
    target: 0,
  }));

  const level = () => 1 + Math.floor(s.metres / 1000);
  const tall = (v: Vehicle) => (v.truck ? truck.h : car.h);

  function spawn(v: Vehicle, top: number) {
    v.lane = Math.floor(Math.random() * 3);
    v.dir = level() >= 3 ? pick([1, -1]) : v.lane === 0 ? -1 : 1;
    v.truck = s.metres >= 4000 && Math.random() < 0.3;
    v.color = pick(colors);
    v.speed = v.dir > 0 ? 14 + Math.random() * 14 : 26 + Math.random() * 16;
    v.x = laneCenter(v.lane);
    v.y = top - Math.random() * 70;
    v.blink = 0;
    v.target = v.lane;
    // Keep a gap to the vehicles already in that lane.
    for (const other of vehicles)
      if (other !== v && other.lane === v.lane && Math.abs(other.y - v.y) < 36)
        v.y = other.y - 42;
  }

  function reset() {
    Object.assign(s, {
      lane: 1,
      x: laneCenter(1),
      metres: 0,
      hearts: 3,
      hurt: 0,
      shield: 0,
      gauge: 1,
      over: false,
    });
    s.pickup.y = -200;
    vehicles.forEach((v, i) => spawn(v, -20 - i * 45));
  }
  reset();

  const free = (lane: number, from: number, to: number) =>
    vehicles.every(
      (v) =>
        !(
          (v.lane === lane || v.target === lane) &&
          v.y + tall(v) > from &&
          v.y < to
        ),
    );

  function stats() {
    report.stat("metres", Math.floor(s.metres));
    report.stat("level", level());
    report.stat("coins", Math.floor(s.metres / 10));
  }

  return {
    width: W,
    height: H,
    keys,
    step(dt, input, demo) {
      s.time += dt;
      if (input.pressed.has("restart") && !demo) {
        reset();
        report.say("Neustart.");
      }
      if (s.over) {
        if (demo) reset();
        stats();
        return;
      }
      let left = input.pressed.has("left");
      let right = input.pressed.has("right");
      let boost = input.held.has("boost");
      if (demo) {
        // Leave the lane when something comes; boost when the way is clear.
        const ahead = (n: number) => free(n, playerY - 46, playerY + 16);
        left = right = false;
        if (!ahead(s.lane)) {
          if (s.lane > 0 && ahead(s.lane - 1)) left = true;
          else if (s.lane < 2 && ahead(s.lane + 1)) right = true;
        }
        boost = free(s.lane, playerY - 80, playerY) && s.gauge > 0.4;
      }
      if (left && s.lane > 0) s.lane -= 1;
      if (right && s.lane < 2) s.lane += 1;
      s.x += (laneCenter(s.lane) - s.x) * Math.min(1, dt * 14);

      s.boosting = boost && s.gauge > 0;
      if (s.boosting) s.gauge = Math.max(0, s.gauge - dt * 0.45);
      else s.gauge = Math.min(1, s.gauge + dt * 0.12);
      const speed = cruise * (s.boosting ? boostFactor : 1);
      const before = level();
      s.scroll += speed * dt;
      s.metres += speed * dt * metresPerUnit;
      if (level() > before) report.say(`Level ${level()}: mehr Verkehr.`);
      if (s.metres >= 4000 && s.metres - speed * dt * metresPerUnit < 4000)
        report.say("Ab 4000 Metern kommen Lastwagen.");
      s.hurt = Math.max(0, s.hurt - dt);
      s.shield = Math.max(0, s.shield - dt);

      for (const v of vehicles) {
        v.y += (speed - v.dir * v.speed) * dt;
        if (v.blink > 0) {
          v.blink -= dt;
          if (v.blink <= 0) v.lane = v.target;
        } else if (
          v.dir > 0 &&
          !v.truck &&
          v.y > 0 &&
          v.y < 50 &&
          Math.random() < dt * 0.25
        ) {
          const to = v.lane + (Math.random() < 0.5 ? -1 : 1);
          if (to >= 0 && to <= 2 && free(to, v.y - 20, v.y + 30)) {
            v.target = to;
            v.blink = 0.9;
          }
        }
        v.x += (laneCenter(v.lane) - v.x) * Math.min(1, dt * 5);
        if (v.y > H + 10) spawn(v, -30);
        const hit =
          Math.abs(v.x - s.x) < 8 &&
          v.y + tall(v) > playerY + 1 &&
          v.y < playerY + car.h - 1;
        if (hit && s.hurt <= 0 && s.shield <= 0) {
          s.hearts -= 1;
          s.hurt = 1.5;
          if (s.hearts <= 0) {
            s.over = true;
            report.say("Keine Herzen mehr. R startet neu.");
          } else report.say("Autsch! Ein Herz weniger.");
        }
      }

      s.pickup.y += speed * dt;
      if (s.pickup.y > H + 10 && Math.random() < dt * 0.15)
        s.pickup = {
          kind: Math.random() < 0.5 ? "heart" : "shield",
          lane: Math.floor(Math.random() * 3),
          y: -10,
        };
      if (
        s.pickup.lane === s.lane &&
        s.pickup.y > playerY - 6 &&
        s.pickup.y < playerY + car.h
      ) {
        if (s.pickup.kind === "heart") {
          s.hearts = Math.min(3, s.hearts + 1);
          report.say("Ein Herz!");
        } else {
          s.shield = 4;
          report.say("Schild: kurz unverwundbar.");
        }
        s.pickup.y = H + 20;
      }
      stats();
    },
    draw(ctx, scale) {
      scenery(ctx, scale, s.scroll);
      const { kind, lane, y } = s.pickup;
      if (y > -10 && y < H + 10)
        (kind === "heart" ? heart : shield)(ctx, scale, laneCenter(lane), y);
      for (const v of vehicles) {
        if (v.y > H + 4 || v.y + tall(v) < -4) continue;
        const blinking =
          v.blink > 0 && Math.floor(v.blink * 6) % 2
            ? Math.sign(v.target - v.lane)
            : 0;
        vehicle(ctx, scale, v.x, v.y, v.dir, v.color, v.truck, blinking);
      }
      ctx.save();
      if (s.hurt > 0 && Math.floor(s.hurt * 10) % 2) ctx.globalAlpha = 0.35;
      player(ctx, scale, s.x, s.boosting, s.time);
      ctx.restore();
      if (s.shield > 0) {
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = "#efe6cf";
        glow(ctx, scale, "#2a62b8", 5, () => {
          ctx.beginPath();
          ctx.roundRect(s.x - 7, playerY - 3, 14, car.h + 6, 4);
          ctx.stroke();
        });
      }
      hud(ctx, scale, s.hearts, s.gauge);
      if (s.over) {
        ctx.fillStyle = "rgba(42, 30, 18, 0.6)";
        ctx.fillRect(0, 0, W, H);
        ctx.font = "700 9px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff6dc";
        glow(ctx, scale, "#c23b2a", 5, () =>
          ctx.fillText("GAME OVER", W / 2, H / 2),
        );
        ctx.font = "700 4px Georgia, serif";
        ctx.fillText("R STARTET NEU", W / 2, H / 2 + 8);
      }
    },
  };
}

/* ---------- Drawing ---------- */

/** The painted meadow, the road with its lanes, lamps and firs, scrolling. */
function scenery(ctx: CanvasRenderingContext2D, scale: number, scroll: number) {
  const floor = ctx.createLinearGradient(0, 0, 0, H);
  floor.addColorStop(0, "#6f9a4a");
  floor.addColorStop(1, "#5b8a3c");
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, W, H);
  // Furrows beside the road.
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = "rgba(40, 70, 30, 0.35)";
  ctx.beginPath();
  const offset = scroll % 12;
  for (let y = offset - 12; y < H; y += 12) {
    ctx.moveTo(0, y);
    ctx.lineTo(road.x - 6, y);
    ctx.moveTo(road.x + road.width + 6, y);
    ctx.lineTo(W, y);
  }
  for (let x = 4; x < W; x += 12) {
    if (x > road.x - 8 && x < road.x + road.width + 8) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  ctx.stroke();
  // Firs beside the road, a nod to the woods around Einsiedeln.
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = "#1f4d2a";
  glow(ctx, scale, "#1f4d2a", 3, () => {
    ctx.beginPath();
    for (const [x, y0] of [
      [22, 10],
      [50, 52],
      [148, 30],
      [176, 80],
      [10, 88],
      [160, 104],
    ]) {
      const y = ((y0 + scroll) % (H + 30)) - 15;
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 4, y + 3);
      ctx.lineTo(x - 4, y + 3);
      ctx.closePath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + 5);
    }
    ctx.stroke();
  });
  // The road and its edges.
  ctx.fillStyle = "#5a5650";
  ctx.fillRect(road.x, 0, road.width, H);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "#efe6cf";
  glow(ctx, scale, "#2a62b8", 4, () => {
    ctx.beginPath();
    ctx.moveTo(road.x, 0);
    ctx.lineTo(road.x, H);
    ctx.moveTo(road.x + road.width, 0);
    ctx.lineTo(road.x + road.width, H);
    ctx.stroke();
  });
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "#f2e6c4";
  ctx.beginPath();
  const dash = scroll % 12;
  for (const lane of [1, 2]) {
    const x = road.x + lane * road.lane;
    for (let y = dash - 12; y < H; y += 12) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 6);
    }
  }
  ctx.stroke();
  // Street lamps on both sides.
  ctx.fillStyle = "#f2c94c";
  glow(ctx, scale, "#f2c94c", 4, () => {
    for (let y = (scroll % 30) - 30; y < H; y += 30) {
      ctx.fillRect(road.x - 3.5, y, 1.2, 1.2);
      ctx.fillRect(road.x + road.width + 2.3, y + 15, 1.2, 1.2);
    }
  });
}

/** A car or truck from above; `dir` -1 faces down (oncoming). */
function vehicle(
  ctx: CanvasRenderingContext2D,
  scale: number,
  x: number,
  y: number,
  dir: number,
  color: string,
  isTruck: boolean,
  blinking: number,
) {
  const { w, h } = isTruck ? truck : car;
  ctx.save();
  ctx.translate(x, y + h / 2);
  if (dir < 0) ctx.rotate(Math.PI);
  ctx.translate(0, -h / 2);
  ctx.fillStyle = "#3a3a46";
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = color;
  glow(ctx, scale, color, 3, () => {
    ctx.beginPath();
    ctx.roundRect(-w / 2, 0, w, h, isTruck ? 1 : 2.5);
    ctx.fill();
    ctx.stroke();
  });
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  if (isTruck) {
    // Cab and trailer.
    ctx.moveTo(-w / 2, 7);
    ctx.lineTo(w / 2, 7);
    ctx.moveTo(-w / 2 + 1.5, 9);
    ctx.lineTo(-w / 2 + 1.5, h - 1.5);
    ctx.moveTo(w / 2 - 1.5, 9);
    ctx.lineTo(w / 2 - 1.5, h - 1.5);
  } else {
    // Windscreen and rear window.
    ctx.moveTo(-w / 2 + 1.5, 4);
    ctx.lineTo(w / 2 - 1.5, 4);
    ctx.moveTo(-w / 2 + 1.5, h - 3.5);
    ctx.lineTo(w / 2 - 1.5, h - 3.5);
  }
  ctx.stroke();
  ctx.fillStyle = "#fff6d8";
  ctx.fillRect(-w / 2 + 1, -0.3, 1.6, 0.9);
  ctx.fillRect(w / 2 - 2.6, -0.3, 1.6, 0.9);
  ctx.fillStyle = "#ff3f6e";
  ctx.fillRect(-w / 2 + 1, h - 0.6, 1.6, 0.9);
  ctx.fillRect(w / 2 - 2.6, h - 0.6, 1.6, 0.9);
  if (blinking) {
    // The indicator on the side it will move to (mirrored when oncoming).
    const side = (blinking * dir * w) / 2;
    ctx.fillStyle = "#ffb347";
    glow(ctx, scale, "#ffb347", 4, () => {
      ctx.fillRect(side - 0.8, 0.5, 1.6, 1.6);
      ctx.fillRect(side - 0.8, h - 2, 1.6, 1.6);
    });
  }
  ctx.restore();
}

/** The player's car with headlights, and the boost flame behind it. */
function player(
  ctx: CanvasRenderingContext2D,
  scale: number,
  x: number,
  boosting: boolean,
  time: number,
) {
  const beam = ctx.createLinearGradient(0, playerY, 0, playerY - 26);
  beam.addColorStop(0, "rgba(255, 246, 216, 0.35)");
  beam.addColorStop(1, "rgba(255, 246, 216, 0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(x - 3.5, playerY);
  ctx.lineTo(x - 7, playerY - 26);
  ctx.lineTo(x + 7, playerY - 26);
  ctx.lineTo(x + 3.5, playerY);
  ctx.fill();
  if (boosting) {
    const length = 7 + Math.sin(time * 40) * 1.5;
    const tail = playerY + car.h;
    const flame = ctx.createLinearGradient(0, tail, 0, tail + length);
    flame.addColorStop(0, "#fff3b0");
    flame.addColorStop(0.5, "#ffd45c");
    flame.addColorStop(1, "rgba(232, 154, 46, 0)");
    glow(ctx, scale, "#ffd45c", 5, () => {
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, tail);
      ctx.lineTo(x, tail + length);
      ctx.lineTo(x + 2.5, tail);
      ctx.fill();
    });
  }
  vehicle(ctx, scale, x, playerY, 1, "#c23b2a", false, 0);
  // Racing stripes.
  ctx.fillStyle = "#2a62b8";
  ctx.fillRect(x - 1.4, playerY + 4.6, 0.8, car.h - 8.6);
  ctx.fillRect(x + 0.6, playerY + 4.6, 0.8, car.h - 8.6);
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.bezierCurveTo(x - 5, y + 0.5, x - 2.5, y - 2.5, x, y - 0.5);
  ctx.bezierCurveTo(x + 2.5, y - 2.5, x + 5, y + 0.5, x, y + 4);
}

/** A heart lying on the road. */
function heart(
  ctx: CanvasRenderingContext2D,
  scale: number,
  x: number,
  y: number,
) {
  ctx.fillStyle = "#c23b2a";
  glow(ctx, scale, "#c23b2a", 4, () => {
    heartPath(ctx, x, y);
    ctx.fill();
  });
}

/** A shield lying on the road. */
function shield(
  ctx: CanvasRenderingContext2D,
  scale: number,
  x: number,
  y: number,
) {
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "#2a62b8";
  ctx.fillStyle = "#123048";
  glow(ctx, scale, "#2a62b8", 4, () => {
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x + 3.2, y - 1.8);
    ctx.quadraticCurveTo(x + 3, y + 3, x, y + 4.5);
    ctx.quadraticCurveTo(x - 3, y + 3, x - 3.2, y - 1.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

/** Hearts top left and the boost gauge bottom left. */
function hud(
  ctx: CanvasRenderingContext2D,
  scale: number,
  hearts: number,
  gauge: number,
) {
  // Dark plates keep the HUD readable over the scrolling scenery.
  ctx.fillStyle = "rgba(42, 30, 18, 0.8)";
  ctx.fillRect(1, 0.5, 28, 9);
  ctx.fillRect(1, H - 12, 36, 11);
  for (let i = 0; i < 3; i++) {
    heartPath(ctx, 7 + i * 8, 5);
    if (i < hearts) {
      ctx.fillStyle = "#c23b2a";
      glow(ctx, scale, "#c23b2a", 3, () => ctx.fill());
    } else {
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(194, 59, 42, 0.6)";
      ctx.stroke();
    }
  }
  ctx.font = "700 3.6px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff6dc";
  ctx.fillText("BOOST", 3, H - 7.5);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "#efe6cf";
  ctx.strokeRect(3, H - 6, 32, 3.5);
  const color = gauge > 0.4 ? "#2a62b8" : "#f2c94c";
  ctx.fillStyle = color;
  glow(ctx, scale, color, 3, () =>
    ctx.fillRect(3.6, H - 5.4, clamp(gauge, 0, 1) * 30.8, 2.3),
  );
}
