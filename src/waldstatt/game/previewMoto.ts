/**
 * Moto Devil's preview in the theatre: the motorbike in side view on a
 * painted stage with a ramp, with the keys from the game's controls table. It
 * accelerates, brakes, tilts into a salto, jumps, fires the jet while Space is
 * held after a jump, turns round and restarts; a bad landing crashes it back
 * to the start. No traps: those wait in the real game. The rules are copied
 * from the studio website's preview; the scenery is repainted.
 */
import { clamp, glow, type Game, type Input, type Report } from "./preview";

const W = 160;
const H = 80;
const ground = 62;
/** A ramp rising to the right, then a drop back to the ground. */
const ramp = { x0: 96, x1: 124, rise: 10 };
const start = 24;

const surface = (x: number) =>
  x >= ramp.x0 && x < ramp.x1
    ? ground - ((x - ramp.x0) / (ramp.x1 - ramp.x0)) * ramp.rise
    : ground;
const slope = (x: number) =>
  x >= ramp.x0 && x < ramp.x1 ? -Math.atan2(ramp.rise, ramp.x1 - ramp.x0) : 0;
/** The angle between two directions, in -π..π. */
const turnBetween = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

const keys: Record<string, string> = {
  w: "gas",
  arrowup: "gas",
  s: "brake",
  arrowdown: "brake",
  a: "back",
  arrowleft: "back",
  d: "forward",
  arrowright: "forward",
  " ": "jump",
  e: "turn",
  r: "restart",
};

export function motoGame(report: Report): Game {
  const s = {
    x: start,
    y: ground,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    dir: 1 as 1 | -1,
    air: false,
    jetFor: 0,
    crashed: 0,
    time: 0,
    saltos: 0,
  };
  let shout = { text: "", left: 0 };
  // The demonstration: every second jump off the ramp becomes a salto, and
  // the laps in between start with a hop.
  const pilot = { laps: 0, salto: false, hopped: false, ramp: false, jet: 0 };

  function say(word: string, words: string) {
    shout = { text: word, left: 1.2 };
    report.say(words);
  }

  function reset() {
    Object.assign(s, {
      x: start,
      y: ground,
      vx: 0,
      vy: 0,
      angle: 0,
      spin: 0,
      dir: 1,
      air: false,
      jetFor: 0,
      crashed: 0,
    });
  }

  /** What the demonstration rider holds and presses now. */
  function autopilot(): Input {
    const held = new Set<string>();
    const pressed = new Set<string>();
    if (s.crashed) return { held, pressed };
    if (!s.air) {
      held.add("gas");
      // A hop on the flat before the ramp, every other lap.
      if (!pilot.hopped && pilot.laps % 2 === 1 && s.x > 50 && s.x < 60) {
        pilot.hopped = true;
        held.add("jump");
        pressed.add("jump");
      }
      if (s.x < 40) pilot.hopped = false;
      return { held, pressed };
    }
    if (pilot.ramp && s.jetFor < pilot.jet) held.add("jump");
    else pilot.jet = 0;
    if (pilot.salto && s.spin < Math.PI * 2 + 0.25) held.add("forward");
    return { held, pressed };
  }

  let wasAir = false;
  return {
    width: W,
    height: H,
    keys,
    step(dt, input, demo) {
      const { held, pressed } = demo ? autopilot() : input;
      s.time += dt;
      shout.left = Math.max(0, shout.left - dt);
      if (pressed.has("restart")) {
        reset();
        say("NEU!", "Neu gestartet");
      }
      if (s.crashed) {
        s.crashed -= dt;
        if (s.crashed <= 0) reset();
        return;
      }
      if (pressed.has("jump") && !s.air) {
        s.air = true;
        s.vy = -78;
        s.spin = 0;
        say("HOPP!", "Springen");
      }
      if (pressed.has("turn")) {
        s.dir = s.dir === 1 ? -1 : 1;
        s.vx *= -0.3;
        say("WENDE!", "Umgedreht");
      }
      if (!held.has("jump")) s.jetFor = 0;
      const tilt = (held.has("forward") ? 1 : 0) - (held.has("back") ? 1 : 0);
      if (held.has("gas")) s.vx += s.dir * 90 * dt;
      if (held.has("brake")) s.vx -= s.vx * Math.min(1, 4 * dt);
      s.vx = clamp(s.vx, -80, 80);

      if (!s.air) {
        s.vx -= s.vx * Math.min(1, 0.7 * dt);
        let x = s.x + s.vx * dt;
        // The drop side of the ramp is a wall when riding left.
        if (surface(x) < surface(s.x) - 2) {
          x = s.x;
          s.vx = 0;
        }
        const before = surface(s.x);
        s.x = x;
        if (surface(s.x) > before + 2 && s.vx > 0) {
          // Off the end of the ramp: into the air.
          s.air = true;
          s.vy = -Math.abs(s.vx) * 0.45;
          s.spin = 0;
          s.y = before;
        } else {
          s.y = surface(s.x);
          // On the ground, tilting only leans the bike a little.
          s.angle += (slope(s.x) + tilt * 0.4 - s.angle) * Math.min(1, dt * 10);
        }
      } else {
        // Holding Space after the jump fires the jet.
        if (held.has("jump")) {
          s.jetFor += dt;
          if (s.jetFor > 0.25) {
            s.vy -= 260 * dt;
            if (s.jetFor - dt <= 0.25) say("WUSCH!", "Düsenschub");
          }
        }
        s.vy = Math.max(s.vy + 180 * dt, -70);
        s.x += s.vx * dt;
        s.y = Math.max(12, s.y + s.vy * dt);
        const turn = tilt * 6 * dt;
        s.angle += turn;
        s.spin += turn;
        if (s.y >= surface(s.x) && s.vy > 0) {
          s.y = surface(s.x);
          s.air = false;
          s.vy = 0;
          if (Math.abs(turnBetween(s.angle, slope(s.x))) > 1.1) {
            s.crashed = 0.9;
            say("UPS!", "Gestürzt, zurück zum Start");
          } else if (Math.abs(s.spin) > Math.PI * 1.7) {
            s.saltos += 1;
            report.stat("saltos", s.saltos);
            say("SALTO!", "Salto!");
          }
          s.angle = slope(s.x);
          s.spin = 0;
        }
      }
      if (s.air && !wasAir) {
        pilot.ramp = s.x > ramp.x0;
        if (pilot.ramp) pilot.laps += 1;
        pilot.salto = pilot.ramp && pilot.laps % 2 === 0;
        pilot.jet = pilot.salto ? 0.75 : 0.5;
      }
      wasAir = s.air;
      // Off one edge, on at the other.
      if (s.x > W + 10) s.x = -10;
      if (s.x < -10) s.x = W + 10;
      if (!s.air) s.y = surface(clamp(s.x, 0, W - 1));
    },
    draw(ctx, scale) {
      ctx.drawImage(backdrop(scale), 0, 0, W, H);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.crashed ? s.dir * 1.6 : s.angle);
      ctx.scale(s.dir, 1);
      if (s.air && s.jetFor > 0.25) jet(ctx, scale, s.time);
      bike(ctx, scale, s.time, s.vx);
      ctx.restore();
      if (shout.left > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, shout.left * 2);
        ctx.font = "700 7px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#2a2420";
        const x = clamp(s.x, 16, W - 16);
        const y = Math.max(9, s.y - 18 - (1.2 - shout.left) * 6);
        glow(ctx, scale, "#c23b2a", 4, () => ctx.fillText(shout.text, x, y));
        ctx.restore();
      }
    },
  };
}

/* ---------- Drawing ---------- */

let cached: { scale: number; image: HTMLCanvasElement } | null = null;

/** The painted backdrop with sun and Mythen, the stage floor and the ramp. */
function backdrop(scale: number) {
  if (cached?.scale === scale) return cached.image;
  const image = document.createElement("canvas");
  image.width = Math.round(W * scale);
  image.height = Math.round(H * scale);
  const ctx = image.getContext("2d");
  cached = { scale, image };
  if (!ctx) return image;
  ctx.scale(scale, scale);
  const sky = ctx.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, "#8fbfe0");
  sky.addColorStop(0.45, "#b2d4ea");
  sky.addColorStop(0.8, "#d6e7ee");
  sky.addColorStop(1, "#f1e8cf");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, ground);
  // The painted sun.
  const sun = { x: 64, y: 40, r: 17 };
  const sunset = ctx.createLinearGradient(0, sun.y - sun.r, 0, sun.y + sun.r);
  sunset.addColorStop(0, "#fff3b0");
  sunset.addColorStop(0.45, "#ffd45c");
  sunset.addColorStop(0.8, "#f4b73e");
  sunset.addColorStop(1, "#e89a2e");
  ctx.save();
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = sunset;
  ctx.fillRect(sun.x - sun.r, sun.y - sun.r, sun.r * 2, sun.r);
  for (let band = 0; band < 6; band++) {
    const y = sun.y + (band * sun.r) / 6;
    ctx.fillRect(sun.x - sun.r, y, sun.r * 2, (sun.r / 6) * (0.8 - band * 0.1));
  }
  ctx.restore();
  // Far ridges, then the two Mythen.
  const ridge = (
    points: [number, number][],
    fill: string,
    stroke: string,
    blur: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(0, ground);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(W, ground);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = stroke;
    glow(ctx, scale, stroke, blur, () => ctx.stroke());
  };
  ridge(
    [
      [0, 44],
      [14, 40],
      [30, 45],
      [46, 38],
      [62, 46],
      [80, 41],
      [98, 47],
      [112, 43],
      [160, 46],
    ],
    "#8aa596",
    "#6b8a79",
    2,
  );
  ridge(
    [
      [0, 52],
      [40, 50],
      [88, 54],
      [104, 46],
      [112, 30],
      [116, 24],
      [120, 31],
      [126, 40],
      [132, 37],
      [138, 30],
      [142, 34],
      [150, 46],
      [160, 50],
    ],
    "#5f8456",
    "#3f6a3a",
    4,
  );
  ctx.font = "700 2.6px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#2a2420";
  ctx.fillText("GROSSER MYTHEN", 116, 21);
  ctx.fillText("KLEINER MYTHEN", 139, 27);
  // The stage boards below the track, in perspective.
  const floor = ctx.createLinearGradient(0, ground, 0, H);
  floor.addColorStop(0, "#a8743f");
  floor.addColorStop(1, "#7a5230");
  ctx.fillStyle = floor;
  ctx.fillRect(0, ground, W, H - ground);
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = "rgba(60, 36, 18, 0.55)";
  ctx.beginPath();
  for (let i = 1; i < 7; i++) {
    const y = ground + (H - ground) * (i / 7) ** 1.6;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  for (let i = -12; i <= 12; i++) {
    ctx.moveTo(W / 2 + i * 6, ground);
    ctx.lineTo(W / 2 + i * 26, H);
  }
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "#2a2420";
  glow(ctx, scale, "#2a2420", 4, () => {
    ctx.beginPath();
    ctx.moveTo(0, ground);
    ctx.lineTo(W, ground);
    ctx.stroke();
  });
  // The ramp with its struts.
  ctx.beginPath();
  ctx.moveTo(ramp.x0, ground);
  ctx.lineTo(ramp.x1, ground - ramp.rise);
  ctx.lineTo(ramp.x1, ground);
  ctx.closePath();
  ctx.fillStyle = "#9a6a3c";
  ctx.fill();
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = "rgba(60, 36, 18, 0.6)";
  ctx.beginPath();
  for (let x = ramp.x0 + 7; x < ramp.x1; x += 7) {
    ctx.moveTo(x, ground);
    ctx.lineTo(x, surface(x));
  }
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "#2a2420";
  glow(ctx, scale, "#2a2420", 5, () => {
    ctx.beginPath();
    ctx.moveTo(ramp.x0, ground);
    ctx.lineTo(ramp.x1, ground - ramp.rise);
    ctx.lineTo(ramp.x1, ground);
    ctx.stroke();
  });
  return image;
}

/** The motorbike and rider, facing right, standing on (0, 0). */
function bike(
  ctx: CanvasRenderingContext2D,
  scale: number,
  time: number,
  speed: number,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Wheels with turning spokes.
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "#2a2420";
  const turned = time * speed * 0.35;
  glow(ctx, scale, "#2a2420", 3, () => {
    ctx.beginPath();
    for (const cx of [-6, 6]) {
      ctx.moveTo(cx + 3, -3);
      ctx.arc(cx, -3, 3, 0, Math.PI * 2);
    }
    ctx.stroke();
  });
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (const cx of [-6, 6]) {
    for (let k = 0; k < 3; k++) {
      const a = turned + (k * Math.PI) / 3;
      ctx.moveTo(cx - Math.cos(a) * 2.6, -3 - Math.sin(a) * 2.6);
      ctx.lineTo(cx + Math.cos(a) * 2.6, -3 + Math.sin(a) * 2.6);
    }
  }
  ctx.stroke();
  // Frame, tank and fork.
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "#c23b2a";
  glow(ctx, scale, "#c23b2a", 3, () => {
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.lineTo(-2, -6.5);
    ctx.lineTo(3.5, -7);
    ctx.lineTo(6, -3);
    ctx.moveTo(-2, -6.5);
    ctx.lineTo(0.5, -3.5);
    ctx.lineTo(3.5, -7);
    ctx.moveTo(-4.5, -7);
    ctx.lineTo(-0.5, -7.6);
    ctx.moveTo(3.5, -7);
    ctx.lineTo(4.5, -9.5);
    ctx.stroke();
  });
  // The rider: leg, body, arm and helmet with visor.
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "#3a3a46";
  ctx.beginPath();
  ctx.moveTo(0.5, -4);
  ctx.lineTo(-1.5, -8);
  ctx.lineTo(0.5, -12.5);
  ctx.lineTo(4.3, -9.6);
  ctx.stroke();
  glow(ctx, scale, "#c23b2a", 3, () => {
    ctx.fillStyle = "#c23b2a";
    ctx.beginPath();
    ctx.arc(1.3, -14.2, 1.9, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#2a2420";
  ctx.fillRect(2, -14.8, 1.4, 0.8);
}

/** The jet's flame behind the bike. */
function jet(ctx: CanvasRenderingContext2D, scale: number, time: number) {
  const length = 7 + Math.sin(time * 40) * 1.5;
  const flame = ctx.createLinearGradient(-8, 0, -8 - length, 0);
  flame.addColorStop(0, "#fff3b0");
  flame.addColorStop(0.5, "#ffd45c");
  flame.addColorStop(1, "rgba(232, 154, 46, 0)");
  glow(ctx, scale, "#ffd45c", 5, () => {
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-7, -7.5);
    ctx.lineTo(-8 - length, -5.5);
    ctx.lineTo(-7, -3.8);
    ctx.closePath();
    ctx.fill();
  });
}
