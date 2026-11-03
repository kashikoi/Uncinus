/* Uncinus — match simulation. Pure logic (no DOM) so it can run under node --test.
   The Mac host owns the match; phones only send input. Coordinates are logical 1600×900. */
(function (root) {
  "use strict";

  const W = 1600;
  const H = 900;
  const PITCH = { L: 110, R: 1490, T: 140, B: 840 };
  const CX = (PITCH.L + PITCH.R) / 2;
  const CY = (PITCH.T + PITCH.B) / 2;
  const GOAL_HALF = 105; // half the goal mouth height
  const GOAL_DEPTH = 52;
  const POST_R = 7;

  const HALF = 24; // players are 48×48 blocks
  const MAX_SPEED = 330;
  const RESPONSE = 2.1; // low = floaty, slightly unruly steering
  const DASH_SPEED = 560;
  const DASH_TIME = 0.22;
  const KICK_COOLDOWN = 0.9;
  const KICK_POWER = 620;

  const BALL_R = 15;
  const BALL_FRICTION = 0.75;
  const BALL_MAX = 1150;
  const WALL_E = 0.78;

  // Mayhem mode: a star drifts onto the pitch now and then; grabbing it makes a player untouchable and
  // the only one who can play the ball until it wears off.
  const STAR_R = 22;
  const STAR_SPEED = 90;
  const STAR_LIFE = 15; // seconds an uncollected star stays on the pitch
  const STAR_POWER = 10; // seconds of invincibility
  const STAR_GAP_MIN = 40; // seconds between stars (uniform, ~1 a minute)
  const STAR_GAP_MAX = 80;
  const STAR_BUMP = 520; // knock-back speed for anyone a star player runs into

  const GOAL_PAUSE = 2.6;
  const DISCONNECT_GRACE = 20;
  const MAX_PLAYERS = 12;

  const TEAMS = {
    left: { id: "left", name: "Sky", color: "#38bdf8", dark: "#0369a1" },
    right: { id: "right", name: "Ember", color: "#fb923c", dark: "#c2410c" },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function createMatch() {
    return {
      t: 0,
      phase: "play",
      phaseTime: 0,
      score: { left: 0, right: 0 },
      players: new Map(),
      ball: { x: CX, y: CY, vx: 0, vy: 0, spin: 0, lastTouch: null },
      events: [],
      nextNumber: { left: 1, right: 1 },
      mayhem: false,
      powered: false,
      star: null,
      starIn: 0,
      rand: Math.random,
    };
  }

  function teamCounts(m) {
    const c = { left: 0, right: 0 };
    for (const p of m.players.values()) c[p.team]++;
    return c;
  }

  // Kickoff spots: a loose 3-wide grid on each player's own half.
  function formationSpot(team, index) {
    const col = Math.floor(index / 3);
    const row = [1, 0, 2][index % 3]; // middle first, then the wings
    const depth = 150 + col * 150;
    const x = team === "left" ? CX - depth : CX + depth;
    const y = CY + (row - 1) * 190 + (col % 2 ? 95 : 0) * (row === 1 ? 0 : 1);
    return { x: clamp(x, PITCH.L + HALF + 10, PITCH.R - HALF - 10), y: clamp(y, PITCH.T + HALF + 10, PITCH.B - HALF - 10) };
  }

  function addPlayer(m, id, name) {
    const existing = m.players.get(id);
    if (existing) {
      existing.name = name || existing.name;
      existing.connected = true;
      existing.goneFor = 0;
      return existing;
    }
    if (m.players.size >= MAX_PLAYERS) return null;
    const counts = teamCounts(m);
    const team = counts.left <= counts.right ? "left" : "right";
    const index = counts[team];
    const spot = formationSpot(team, index);
    const player = {
      id,
      name: name || "Player",
      team,
      number: m.nextNumber[team]++,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      facing: team === "left" ? 0 : Math.PI,
      input: { x: 0, y: 0 },
      kickSeen: null,
      dash: 0,
      cooldown: 0,
      kickedBall: false,
      star: 0,
      connected: true,
      goneFor: 0,
      joinedAt: m.t,
    };
    m.players.set(id, player);
    return player;
  }

  // Move a player to the chosen team with a new jersey number and a kickoff spot on that half.
  function setTeam(m, id, team) {
    const p = m.players.get(id);
    if (!p || !TEAMS[team]) return null;
    if (p.team === team) return p;
    p.team = team;
    p.number = m.nextNumber[team]++;
    const spot = formationSpot(team, teamCounts(m)[team] - 1);
    Object.assign(p, { x: spot.x, y: spot.y, vx: 0, vy: 0, dash: 0, facing: team === "left" ? 0 : Math.PI });
    return p;
  }

  function disconnectPlayer(m, id) {
    const p = m.players.get(id);
    if (!p) return;
    p.connected = false;
    p.input = { x: 0, y: 0 };
  }

  function sanitizeInput(raw) {
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, -1, 1) : 0);
    let x = num(raw && raw.x);
    let y = num(raw && raw.y);
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    const k = raw && Number.isInteger(raw.k) && raw.k >= 0 ? raw.k : null;
    return { x, y, k };
  }

  // `k` is a press counter from the phone, so a quick tap between network ticks is never lost.
  function setInput(m, id, raw) {
    const p = m.players.get(id);
    if (!p) return false;
    const input = sanitizeInput(raw);
    p.input = { x: input.x, y: input.y };
    if (input.k !== null) {
      if (p.kickSeen !== null && input.k !== p.kickSeen) kick(m, p);
      p.kickSeen = input.k;
    }
    return true;
  }

  function kick(m, p) {
    if (p.cooldown > 0 || !p.connected) return false;
    const mag = Math.hypot(p.input.x, p.input.y);
    const dir = mag > 0.2 ? Math.atan2(p.input.y, p.input.x) : p.facing;
    p.vx += Math.cos(dir) * DASH_SPEED;
    p.vy += Math.sin(dir) * DASH_SPEED;
    p.facing = dir;
    p.dash = DASH_TIME;
    p.cooldown = KICK_COOLDOWN;
    p.kickedBall = false;
    m.events.push({ type: "dash", id: p.id });
    return true;
  }

  function resetKickoff(m) {
    const b = m.ball;
    Object.assign(b, { x: CX, y: CY, vx: 0, vy: 0, lastTouch: null });
    const index = { left: 0, right: 0 };
    const players = [...m.players.values()].sort((a, b2) => a.joinedAt - b2.joinedAt);
    for (const p of players) {
      const spot = formationSpot(p.team, index[p.team]++);
      Object.assign(p, { x: spot.x, y: spot.y, vx: 0, vy: 0, dash: 0, facing: p.team === "left" ? 0 : Math.PI });
    }
    m.phase = "play";
    m.phaseTime = 0;
  }

  function resetMatch(m) {
    m.score = { left: 0, right: 0 };
    clearStars(m);
    resetKickoff(m);
    m.events.push({ type: "reset" });
  }

  function collidePlayerBall(m, p) {
    if (m.powered && p.star <= 0) return;
    const b = m.ball;
    const cx = clamp(b.x, p.x - HALF, p.x + HALF);
    const cy = clamp(b.y, p.y - HALF, p.y + HALF);
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= BALL_R) return;
    let nx;
    let ny;
    let overlap;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
      overlap = BALL_R - d;
    } else {
      // Ball center is inside the block: push it out through the nearest face.
      const ox = b.x - p.x;
      const oy = b.y - p.y;
      if (HALF - Math.abs(ox) < HALF - Math.abs(oy)) {
        nx = Math.sign(ox) || 1;
        ny = 0;
        overlap = HALF - Math.abs(ox) + BALL_R;
      } else {
        nx = 0;
        ny = Math.sign(oy) || 1;
        overlap = HALF - Math.abs(oy) + BALL_R;
      }
    }
    b.x += nx * overlap;
    b.y += ny * overlap;
    const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
    if (vn < 0) {
      b.vx -= 1.45 * vn * nx;
      b.vy -= 1.45 * vn * ny;
    }
    if (p.dash > 0 && !p.kickedBall) {
      b.vx += nx * KICK_POWER;
      b.vy += ny * KICK_POWER;
      p.kickedBall = true;
      m.events.push({ type: "kick", id: p.id, x: b.x, y: b.y });
    }
    b.lastTouch = p.id;
  }

  function collidePlayers(a, c) {
    const r = HALF * 1.9;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= r || d < 1e-6) return;
    const nx = dx / d;
    const ny = dy / d;
    if ((a.star > 0) !== (c.star > 0)) {
      // The star player doesn't budge; whoever they touch is flung away.
      const [hero, other, sx, sy] = a.star > 0 ? [a, c, nx, ny] : [c, a, -nx, -ny];
      other.x += sx * (r - d);
      other.y += sy * (r - d);
      other.vx = sx * STAR_BUMP + hero.vx * 0.3;
      other.vy = sy * STAR_BUMP + hero.vy * 0.3;
      other.dash = 0;
      return;
    }
    const push = (r - d) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    c.x += nx * push;
    c.y += ny * push;
    const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
    if (vn < 0) {
      const j = -0.65 * vn;
      a.vx -= j * nx;
      a.vy -= j * ny;
      c.vx += j * nx;
      c.vy += j * ny;
    }
  }

  function bounceOffPost(b, px, py) {
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const min = BALL_R + POST_R;
    if (d >= min || d < 1e-6) return;
    const nx = dx / d;
    const ny = dy / d;
    b.x = px + nx * min;
    b.y = py + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + WALL_E) * vn * nx;
      b.vy -= (1 + WALL_E) * vn * ny;
    }
  }

  function stepBall(m, dt) {
    const b = m.ball;
    const f = Math.exp(-BALL_FRICTION * dt);
    b.vx *= f;
    b.vy *= f;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > BALL_MAX) {
      b.vx *= BALL_MAX / speed;
      b.vy *= BALL_MAX / speed;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += (speed / BALL_R) * dt;
  }

  function constrainBall(b) {
    const inMouth = Math.abs(b.y - CY) < GOAL_HALF;
    const inGoal = inMouth && (b.x < PITCH.L || b.x > PITCH.R);

    if (inGoal) {
      // Inside the net: back wall and side netting.
      const back = b.x < PITCH.L ? PITCH.L - GOAL_DEPTH + BALL_R : PITCH.R + GOAL_DEPTH - BALL_R;
      if ((b.x < PITCH.L && b.x < back) || (b.x > PITCH.R && b.x > back)) {
        b.x = back;
        b.vx *= -0.3;
      }
      if (b.y < CY - GOAL_HALF + BALL_R) {
        b.y = CY - GOAL_HALF + BALL_R;
        b.vy = Math.abs(b.vy) * 0.3;
      } else if (b.y > CY + GOAL_HALF - BALL_R) {
        b.y = CY + GOAL_HALF - BALL_R;
        b.vy = -Math.abs(b.vy) * 0.3;
      }
    } else {
      if (b.y < PITCH.T + BALL_R) {
        b.y = PITCH.T + BALL_R;
        b.vy = Math.abs(b.vy) * WALL_E;
      } else if (b.y > PITCH.B - BALL_R) {
        b.y = PITCH.B - BALL_R;
        b.vy = -Math.abs(b.vy) * WALL_E;
      }
      if (!inMouth) {
        if (b.x < PITCH.L + BALL_R) {
          b.x = PITCH.L + BALL_R;
          b.vx = Math.abs(b.vx) * WALL_E;
        } else if (b.x > PITCH.R - BALL_R) {
          b.x = PITCH.R - BALL_R;
          b.vx = -Math.abs(b.vx) * WALL_E;
        }
      }
    }
    for (const px of [PITCH.L, PITCH.R]) {
      bounceOffPost(b, px, CY - GOAL_HALF);
      bounceOffPost(b, px, CY + GOAL_HALF);
    }
  }

  function checkGoal(m) {
    const b = m.ball;
    if (b.y - BALL_R < CY - GOAL_HALF || b.y + BALL_R > CY + GOAL_HALF) return;
    let team = null;
    if (b.x + BALL_R < PITCH.L && b.x - BALL_R >= PITCH.L - GOAL_DEPTH) team = "right";
    else if (b.x - BALL_R > PITCH.R && b.x + BALL_R <= PITCH.R + GOAL_DEPTH) team = "left";
    if (!team) return;
    m.score[team]++;
    const scorer = b.lastTouch ? m.players.get(b.lastTouch) : null;
    m.events.push({
      type: "goal",
      team,
      scorerId: scorer ? scorer.id : null,
      scorerName: scorer ? scorer.name : null,
      ownGoal: Boolean(scorer && scorer.team !== team),
      score: { ...m.score },
    });
    m.phase = "goal";
    m.phaseTime = 0;
  }

  const starGap = (m) => STAR_GAP_MIN + m.rand() * (STAR_GAP_MAX - STAR_GAP_MIN);

  function clearStars(m) {
    m.star = null;
    for (const p of m.players.values()) {
      if (p.star > 0) m.events.push({ type: "star-end", id: p.id });
      p.star = 0;
    }
    m.powered = false;
    m.starIn = starGap(m);
  }

  function setMayhem(m, on) {
    m.mayhem = Boolean(on);
    clearStars(m);
  }

  function spawnStar(m) {
    const a = m.rand() * Math.PI * 2;
    m.star = {
      x: PITCH.L + 160 + m.rand() * (PITCH.R - PITCH.L - 320),
      y: PITCH.T + 80 + m.rand() * (PITCH.B - PITCH.T - 160),
      vx: Math.cos(a) * STAR_SPEED,
      vy: Math.sin(a) * STAR_SPEED,
      age: 0,
    };
    m.events.push({ type: "star-spawn", x: m.star.x, y: m.star.y });
  }

  function stepStar(m, dt, list) {
    if (!m.mayhem || m.phase !== "play") return;
    const s = m.star;
    if (!s) {
      if (m.powered) return;
      m.starIn -= dt;
      if (m.starIn <= 0) spawnStar(m);
      return;
    }
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.x < PITCH.L + STAR_R || s.x > PITCH.R - STAR_R) s.vx *= -1;
    if (s.y < PITCH.T + STAR_R || s.y > PITCH.B - STAR_R) s.vy *= -1;
    s.x = clamp(s.x, PITCH.L + STAR_R, PITCH.R - STAR_R);
    s.y = clamp(s.y, PITCH.T + STAR_R, PITCH.B - STAR_R);
    if (s.age >= STAR_LIFE) {
      m.star = null;
      m.starIn = starGap(m);
      m.events.push({ type: "star-gone" });
      return;
    }
    for (const p of list) {
      if (!p.connected || !m.players.has(p.id)) continue;
      const dx = s.x - clamp(s.x, p.x - HALF, p.x + HALF);
      const dy = s.y - clamp(s.y, p.y - HALF, p.y + HALF);
      if (Math.hypot(dx, dy) < STAR_R) {
        p.star = STAR_POWER;
        m.star = null;
        m.powered = true;
        m.starIn = starGap(m);
        m.events.push({ type: "star-get", id: p.id, name: p.name, x: s.x, y: s.y });
        return;
      }
    }
  }

  function step(m, dtRaw) {
    const dt = clamp(dtRaw, 0, 0.05);
    m.t += dt;
    m.phaseTime += dt;
    const k = Math.min(1, RESPONSE * dt);

    for (const p of [...m.players.values()]) {
      if (!p.connected) {
        p.goneFor += dt;
        if (p.goneFor > DISCONNECT_GRACE) {
          m.players.delete(p.id);
          if (m.ball.lastTouch === p.id) m.ball.lastTouch = null;
          continue;
        }
      }
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.star > 0) {
        p.star = Math.max(0, p.star - dt);
        if (p.star === 0) m.events.push({ type: "star-end", id: p.id });
      }
      p.dash = Math.max(0, p.dash - dt);
      // While dashing, momentum wins; otherwise ease toward the stick (sluggish on purpose).
      const kk = p.dash > 0 ? k * 0.15 : k;
      p.vx += (p.input.x * MAX_SPEED - p.vx) * kk;
      p.vy += (p.input.y * MAX_SPEED - p.vy) * kk;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (Math.hypot(p.vx, p.vy) > 25) p.facing = Math.atan2(p.vy, p.vx);
      const minX = PITCH.L + HALF;
      const maxX = PITCH.R - HALF;
      const minY = PITCH.T + HALF;
      const maxY = PITCH.B - HALF;
      if (p.x < minX || p.x > maxX) {
        p.x = clamp(p.x, minX, maxX);
        p.vx *= -0.4;
      }
      if (p.y < minY || p.y > maxY) {
        p.y = clamp(p.y, minY, maxY);
        p.vy *= -0.4;
      }
    }

    const list = [...m.players.values()];
    m.powered = list.some((p) => p.star > 0);
    stepStar(m, dt, list);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) collidePlayers(list[i], list[j]);

    // Substep the ball so fast shots don't tunnel through players or posts.
    const sub = Math.max(1, Math.ceil((Math.hypot(m.ball.vx, m.ball.vy) * dt) / (BALL_R * 0.8)));
    for (let s = 0; s < sub; s++) {
      stepBall(m, dt / sub);
      if (m.phase === "play") for (const p of list) if (m.players.has(p.id)) collidePlayerBall(m, p);
      // Player contact can displace the ball through a wall, so constrain it last.
      constrainBall(m.ball);
    }

    if (m.phase === "play") checkGoal(m);
    else if (m.phase === "goal" && m.phaseTime >= GOAL_PAUSE) resetKickoff(m);
  }

  function drainEvents(m) {
    const out = m.events;
    m.events = [];
    return out;
  }

  const api = {
    W,
    H,
    PITCH,
    CX,
    CY,
    GOAL_HALF,
    GOAL_DEPTH,
    POST_R,
    HALF,
    BALL_R,
    MAX_PLAYERS,
    GOAL_PAUSE,
    KICK_COOLDOWN,
    STAR_R,
    STAR_LIFE,
    STAR_POWER,
    STAR_GAP_MIN,
    STAR_GAP_MAX,
    DISCONNECT_GRACE,
    TEAMS,
    createMatch,
    addPlayer,
    setTeam,
    setMayhem,
    disconnectPlayer,
    sanitizeInput,
    setInput,
    kick,
    step,
    resetKickoff,
    resetMatch,
    formationSpot,
    drainEvents,
  };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.match = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
