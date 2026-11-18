/* Uncinus — bots: computer players. A bot drives its block through the same inputs a phone sends (a run vector and
   kick presses), so it obeys the same floaty physics as everyone else. Pure logic (no DOM) so it runs under
   node --test. The host owns the brains (id → brain) and calls drive() once a frame before stepping the match. */
(function (root) {
  "use strict";

  const M = root.Uncinus && root.Uncinus.match ? root.Uncinus.match : require("./match.js");

  // How long a bot takes to react (s), how long it hesitates at each kickoff (s), how far its aim wanders across the
  // goal mouth, how hard it runs, how keen it is to kick, and whether teammates spread into roles (Easy bots all
  // chase the ball, like kids do).
  const SKILLS = {
    easy: { think: [0.24, 0.38], hesitate: [0.6, 1.1], aim: 0.6, pace: 0.72, kick: 0.45, roles: false },
    normal: { think: [0.12, 0.22], hesitate: [0.4, 0.8], aim: 0.3, pace: 0.9, kick: 0.75, roles: true },
    hard: { think: [0.05, 0.1], hesitate: [0.25, 0.5], aim: 0.12, pace: 1, kick: 0.95, roles: true },
  };
  const NAMES = [
    "Gizmo", "Sprocket", "Widget", "Rusty", "Turbo", "Pixel", "Bolt", "Chip", "Cog", "Byte", "Servo", "Dynamo",
    "Gadget", "Tinker", "Bleep", "Zippy", "Rivet", "Volt", "Nano", "Sparky", "Beep", "Ratchet", "Diode", "Flux",
  ];
  const STUCK_TIME = 1.2; // seconds of a dead ball at a bot's feet before it just boots it
  // Shot angles a bot considers, relative to straight at the goal: it lines up the most open one, so two bots don't
  // run head-on into the same ball (which squeezes it back through one of them, often into their own net).
  const SHOT_OFFSETS = [0, 0.42, -0.42, 0.85, -0.85, 1.3, -1.3];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function createBrain({ skill = "normal", rand = Math.random } = {}) {
    return { skill: SKILLS[skill] ? skill : "normal", rand, wait: 0, x: 0, y: 0, k: 0, aim: 0, shot: 0, role: "chase", lane: 0, stuck: 0, seen: Infinity, wake: 0 };
  }

  // A robot name nobody on the pitch is using yet.
  function pickName(taken, rand = Math.random) {
    const used = new Set(taken);
    const free = NAMES.filter((n) => !used.has(n));
    if (free.length) return free[Math.floor(rand() * free.length)];
    for (let i = 2; ; i++) for (const n of NAMES) if (!used.has(`${n} ${i}`)) return `${n} ${i}`;
  }

  // Per team: the bot nearest the ball chases it (the current chaser gets a head start, so they don't dither);
  // with three or more bots the one nearest our goal keeps goal; the rest support in lanes.
  function assignRoles(m, bots) {
    const teams = { left: [], right: [] };
    for (const bot of bots) teams[bot.p.team].push(bot);
    for (const [team, list] of Object.entries(teams)) {
      if (!list.length) continue;
      if (!SKILLS[list[0].brain.skill].roles) {
        for (const bot of list) bot.brain.role = "chase";
        continue;
      }
      const b = m.ball;
      const dist = (bot) => Math.hypot(bot.p.x - b.x, bot.p.y - b.y) - (bot.brain.role === "chase" ? 80 : 0);
      list.sort((a, c) => dist(a) - dist(c));
      list[0].brain.role = "chase";
      const rest = list.slice(1);
      const ownX = M.defends(m, team) === "left" ? M.PITCH.L : M.PITCH.R;
      if (rest.length >= 2) {
        rest.sort((a, c) => Math.abs(a.p.x - ownX) - Math.abs(c.p.x - ownX));
        rest.shift().brain.role = "keep";
      }
      rest.forEach((bot, i) => {
        bot.brain.role = "support";
        bot.brain.lane = (i % 2 ? 1 : -1) * (Math.floor(i / 2) + 1) * (rest.length === 1 ? 0.6 : 1);
      });
    }
  }

  // The direction to send the ball: the best mix of heading for goal and not hitting an opponent in the way.
  function shotLine(m, p, brain, goalX, goalY) {
    const { PITCH, BALL_R } = M;
    const b = m.ball;
    const base = Math.atan2(goalY - b.y, goalX - b.x);
    let best = null;
    for (const off of SHOT_OFFSETS) {
      const ux = Math.cos(base + off);
      const uy = Math.sin(base + off);
      let score = Math.cos(off) + (off === brain.shot ? 0.15 : 0);
      for (const q of m.players.values()) {
        if (q.team === p.team) continue;
        const qx = q.x - b.x;
        const qy = q.y - b.y;
        const along = qx * ux + qy * uy;
        if (along < -10 || along > 260) continue;
        if (Math.abs(qx * -uy + qy * ux) < M.HALF * (q.scale || 1) + BALL_R + 10) score -= 1.5 * (1 - along / 320);
      }
      const ey = b.y + uy * 120;
      if (ey < PITCH.T + 10 || ey > PITCH.B - 10) score -= 0.6; // not straight into the touchline
      if (!best || score > best.score) best = { off, ux, uy, score };
    }
    brain.shot = best.off;
    return best;
  }

  function decide(m, p, brain, s) {
    const { PITCH, CX, CY, GOAL_HALF, BALL_R } = M;
    // A fresh kickoff (the match's phase clock went back to zero): take a moment before charging, like people do.
    if (m.phaseTime < brain.seen) brain.wake = s.hesitate[0] + brain.rand() * (s.hesitate[1] - s.hesitate[0]);
    brain.seen = m.phaseTime;
    // Stand still for goal celebrations, the full-time whistle, and that kickoff moment.
    if (m.phase !== "play" || m.period === "full" || m.phaseTime < brain.wake) {
      brain.x = 0;
      brain.y = 0;
      return;
    }
    const b = m.ball;
    const r = M.HALF * (p.scale || 1) + BALL_R + 6;
    const dir = M.defends(m, p.team) === "left" ? 1 : -1; // +1: we attack the right-hand goal
    const ownX = dir > 0 ? PITCH.L : PITCH.R;
    if (brain.rand() < 0.12) brain.aim = (brain.rand() * 2 - 1) * s.aim;
    const mouth = (end) => (M.mouthAt ? M.mouthAt(m, end) : GOAL_HALF);
    const line = shotLine(m, p, brain, dir > 0 ? PITCH.R + 30 : PITCH.L - 30, CY + brain.aim * (mouth(dir > 0 ? "right" : "left") + 40));
    const gx = line.ux;
    const gy = line.uy;
    const px = p.x - b.x; // ball → me
    const py = p.y - b.y;
    const dBall = Math.hypot(px, py) || 1;
    const behind = px * gx + py * gy; // < 0: I'm on the far side of the ball from their goal (where I want to be)
    const lateral = px * -gy + py * gx; // how far I am off the line the ball should travel
    const defending = Math.abs(b.x - ownX) < 420;
    let role = brain.role;
    if (role !== "chase" && dBall < 90) role = "chase"; // anyone close to the ball plays it

    let tx;
    let ty;
    let kick = false;
    let pace = s.pace * (m.period === "pre" ? 0.6 : 1);
    if (role === "chase") {
      if (behind < -r * 0.25) {
        if (Math.abs(lateral) < 18) {
          tx = b.x + gx * 60; // lined up: run straight through it
          ty = b.y + gy * 60;
        } else {
          tx = b.x - gx * r; // get in behind the ball
          ty = b.y - gy * r;
        }
      } else {
        // Wrong side of the ball: loop round it on the side we're already on.
        const side = lateral >= 0 ? 1 : -1;
        tx = b.x - gx * r * 0.8 - gy * side * (r + 30);
        ty = b.y - gy * r * 0.8 + gx * side * (r + 30);
      }
      // Dash into the ball when it's close and the shot (or, near our goal, the clearance) points the right way —
      // but not when an opponent is pressed against the far side of it: that just squeezes the ball back at us.
      const align = (-px * gx + -py * gy) / dBall; // me→ball against the shot line
      const ready = p.cooldown <= 0 && dBall < r + 26;
      const slow = Math.hypot(b.vx, b.vy) < 40;
      let blocked = false;
      for (const q of m.players.values()) {
        if (q.team === p.team) continue;
        const qx = q.x - b.x;
        const qy = q.y - b.y;
        if (Math.hypot(qx, qy) < M.HALF * (q.scale || 1) + BALL_R + 18 && qx * -px + qy * -py > 0) blocked = true;
      }
      brain.stuck = ready && slow ? brain.stuck + brain.wait : 0;
      if (ready && !blocked && align > (defending ? 0.3 : 0.72) && brain.rand() < s.kick) kick = true;
      // A dead ball at our feet: boot it, as long as that doesn't send it back toward our own goal.
      else if (ready && brain.stuck > STUCK_TIME * (blocked ? 2 : 1) && (-px * dir) / dBall > -0.2) kick = true;
    } else {
      const items = [m.star, m.shroom, m.flower, m.brick, m.turkey].filter(Boolean);
      const item = items.find((it) => Math.hypot(it.x - p.x, it.y - p.y) < 260);
      if (item) {
        tx = item.x; // Mayhem: grab a power-up that's close by
        ty = item.y;
      } else if (role === "keep") {
        tx = ownX + dir * 60;
        const gh = mouth(dir > 0 ? "left" : "right");
        ty = clamp(CY + (b.y - CY) * 0.7, CY - gh + 10, CY + gh - 10);
        pace *= 0.9;
      } else {
        const f = defending ? 0.45 : 0.62; // between the ball and our goal, spread across the pitch
        tx = ownX + (b.x - ownX) * f;
        ty = CY + (b.y - CY) * 0.4 + brain.lane * 150;
      }
    }

    if (kick) {
      brain.x = -px / dBall; // the dash goes the way we steer: straight at the ball
      brain.y = -py / dBall;
      brain.k++;
      brain.stuck = 0;
      return;
    }
    tx = clamp(tx, PITCH.L + 30, PITCH.R - 30);
    ty = clamp(ty, PITCH.T + 30, PITCH.B - 30);
    const mx = tx - p.x;
    const my = ty - p.y;
    const md = Math.hypot(mx, my);
    const sp = (md < 50 ? md / 50 : 1) * pace;
    brain.x = md > 2 ? (mx / md) * sp : 0;
    brain.y = md > 2 ? (my / md) * sp : 0;
  }

  // Steer every bot that's on the pitch: think every so often (reaction time), send the latest decision every frame.
  function drive(m, brains, dt) {
    const bots = [];
    for (const [id, brain] of brains) {
      const p = m.players.get(id);
      if (p) bots.push({ p, brain });
    }
    if (!bots.length) return;
    assignRoles(m, bots);
    for (const { p, brain } of bots) {
      brain.wait -= dt;
      if (brain.wait <= 0) {
        const s = SKILLS[brain.skill];
        brain.wait = s.think[0] + brain.rand() * (s.think[1] - s.think[0]);
        decide(m, p, brain, s);
      }
      M.setInput(m, p.id, { x: brain.x, y: brain.y, k: brain.k });
    }
  }

  const api = { SKILLS, NAMES, createBrain, pickName, drive };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.bots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
