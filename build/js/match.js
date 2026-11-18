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

  // Mayhem mode: a star drifts onto the pitch now and then; grabbing it turns a player into a ghost who
  // passes through everyone and is the only one who can touch the ball until it wears off.
  const STAR_R = 22;
  const STAR_SPEED = 90;
  const STAR_LIFE = 15; // seconds an uncollected star stays on the pitch
  const STAR_POWER = 10; // seconds of invincibility
  const STAR_GAP_MIN = 40; // seconds between stars (uniform, ~1 a minute)
  const STAR_GAP_MAX = 80;
  // ...and a mushroom sprouts now and then; eating it makes a player BIG_SCALE× bigger and heavier.
  const SHROOM_R = 20;
  const SHROOM_LIFE = 15;
  const BIG_POWER = 12; // seconds of being huge
  const BIG_SCALE = 2.5;
  const SHROOM_GAP_MIN = 35;
  const SHROOM_GAP_MAX = 75;
  // ...and a power flower blooms now and then; while it lasts, goals its holder scores count `m.flowerPoints`
  // (the host's choice of FLOWER_CHOICES; FLOWER_POINTS by default).
  const FLOWER_R = 20;
  const FLOWER_LIFE = 15;
  const FLOWER_POWER = 20; // seconds of flower power
  const FLOWER_POINTS = 2;
  const FLOWER_CHOICES = [2, 3, 5];
  const FLOWER_GAP_MIN = 45;
  const FLOWER_GAP_MAX = 90;
  // ...and a magic brick turns up now and then: grab it and your team's goal is bricked down to a sliver
  // (BRICK_SHRINK of its width) while the other team's goal swells to BRICK_GROW× for BRICK_POWER seconds.
  const BRICK_R = 20;
  const BRICK_LIFE = 15;
  const BRICK_POWER = 10;
  const BRICK_SHRINK = 0.45;
  const BRICK_GROW = 1.6;
  const BRICK_GAP_MIN = 45;
  const BRICK_GAP_MAX = 90;
  const MOUTH_RATE = 3; // how fast the goal mouths ease to their new size (1/s)

  // ...and a turkey gets loose now and then: it scurries about, flapping, and runs from anyone who comes close.
  // Catch it and the other team falls into a food coma — stuffed, they move at COMA_SLOW speed and can't kick.
  const TURKEY_R = 24;
  const TURKEY_LIFE = 20; // seconds before it flaps off the pitch
  const TURKEY_SPEED = 210; // pottering about
  const TURKEY_FLEE = 440; // running away: faster than a player runs, slower than a dash
  const TURKEY_SCARE = 260; // how close a player gets before it bolts
  const TURKEY_HOP = 760; // a flapping flutter-hop sideways when someone's right on top of it…
  const TURKEY_HOP_NEAR = 95;
  const TURKEY_HOP_GAP = 1.1; // …then it needs a moment to get its breath back
  const COMA_POWER = 8; // seconds of food coma
  const COMA_SLOW = 0.45;
  const TURKEY_GAP_MIN = 50;
  const TURKEY_GAP_MAX = 95;
  // The Mayhem powers, each of which can be switched off.
  const POWERS = ["star", "shroom", "flower", "brick", "turkey"];

  // Stationary pick-ups: where they live on the match, the player field they power up, and their timings.
  // Only one player at a time holds each kind of power.
  const ITEMS = {
    shroom: { field: "big", r: SHROOM_R, life: SHROOM_LIFE, power: BIG_POWER, gapMin: SHROOM_GAP_MIN, gapMax: SHROOM_GAP_MAX },
    flower: { field: "flower", r: FLOWER_R, life: FLOWER_LIFE, power: FLOWER_POWER, gapMin: FLOWER_GAP_MIN, gapMax: FLOWER_GAP_MAX },
    brick: { field: "brick", r: BRICK_R, life: BRICK_LIFE, power: BRICK_POWER, gapMin: BRICK_GAP_MIN, gapMax: BRICK_GAP_MAX },
  };
  const GROW_RATE = 6; // how fast size eases toward its target (1/s)
  const BUMP_SPEED = 140; // closing speed (px/s) for a player–player crash to count as a "bump" (oof!)

  // Timed games: two halves counting down (straight into the second-half kickoff; teams swap ends only if `swapEnds`),
  // "next goal wins" if it's level at the end, and a full-time result before the next game starts by itself.
  // Length 0 = no limit (endless play, no clock).
  const GAME_LENGTHS = [0, 5, 10, 15, 30]; // minutes
  const CUP_LENGTHS = [2, 3, 4, 5]; // shorter games for championship matches
  const FULLTIME_SHOW = 20; // seconds the result stays up

  const GOAL_PAUSE = 2.6;
  const DISCONNECT_GRACE = 20;
  const MAX_PLAYERS = 12;

  const TEAMS = {
    left: { id: "left", name: "Blue", color: "#38bdf8", dark: "#0369a1" },
    right: { id: "right", name: "Orange", color: "#fb923c", dark: "#c2410c" },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Which end ("left"/"right") a team defends right now, and which team defends an end.
  const defends = (m, team) => ((team === "left") !== Boolean(m && m.swapped) ? "left" : "right");
  const teamAt = (m, end) => (defends(m, "left") === end ? "left" : "right");
  const kickoffFacing = (m, team) => (defends(m, team) === "left" ? 0 : Math.PI);
  const playing = (m) => m.period === "free" || m.period === "first" || m.period === "second" || m.period === "golden";
  const half = (p) => HALF * (p.scale || 1);
  const mass = (p) => (p.scale || 1) ** 2;
  const mouthAt = (m, end) => (m && m.mouth ? m.mouth[end] : GOAL_HALF);

  // Where each goal mouth is heading: a brick holder's own goal shrinks and the other one grows.
  function mouthTarget(m, end) {
    for (const p of m.players.values()) {
      if (p.brick > 0) return GOAL_HALF * (defends(m, p.team) === end ? BRICK_SHRINK : BRICK_GROW);
    }
    return GOAL_HALF;
  }

  function stepMouths(m, dt) {
    for (const end of ["left", "right"]) {
      const target = mouthTarget(m, end);
      m.mouth[end] += (target - m.mouth[end]) * Math.min(1, MOUTH_RATE * dt);
      if (Math.abs(target - m.mouth[end]) < 0.05) m.mouth[end] = target;
    }
  }

  // Does a circle at (x, y) with radius r touch player p's block?
  function touches(p, x, y, r) {
    const h = half(p);
    return Math.hypot(x - clamp(x, p.x - h, p.x + h), y - clamp(y, p.y - h, p.y + h)) < r;
  }

  function createMatch() {
    return {
      t: 0,
      phase: "play",
      phaseTime: 0,
      length: 0, // seconds for the whole game; 0 = no limit
      period: "free", // free | pre | first | second | golden (next goal wins) | full
      clock: 0, // seconds left in the current period
      swapped: false, // ends are swapped (2nd half, when `swapEnds` is on)
      swapEnds: false, // swap ends at half time (a Settings rule; off by default)
      score: { left: 0, right: 0 },
      players: new Map(),
      ball: { x: CX, y: CY, vx: 0, vy: 0, spin: 0, lastTouch: null },
      events: [],
      nextNumber: { left: 1, right: 1 },
      mayhem: false,
      powered: false,
      star: null,
      starIn: 0,
      shroom: null,
      shroomIn: 0,
      flower: null,
      flowerIn: 0,
      brick: null,
      brickIn: 0,
      mouth: { left: GOAL_HALF, right: GOAL_HALF }, // half the goal mouth height at each end (the brick changes it)
      turkey: null,
      turkeyIn: 0,
      powers: { star: true, shroom: true, flower: true, brick: true, turkey: true },
      rand: Math.random,
      flowerPoints: FLOWER_POINTS,
      goalPause: GOAL_PAUSE, // seconds from a goal to the kickoff (the host stretches it to fit a replay)
      turn: 0, // rotates which player's ball contact resolves first
      // Championship matches: the host kicks off ("pre" waits) and moves on after full time ("full" holds).
      manual: false,
      maxPlayers: MAX_PLAYERS,
    };
  }

  function teamCounts(m) {
    const c = { left: 0, right: 0 };
    for (const p of m.players.values()) c[p.team]++;
    return c;
  }

  // Kickoff spots: a loose 3-wide grid on the half a team defends. Big teams (championship finals) get a
  // 5-wide grid with columns squeezed to fit their half.
  function formationSpot(team, index, swapped = false, size = 0) {
    const rows = size > 9 ? 5 : 3;
    const col = Math.floor(index / rows);
    const row = (rows === 3 ? [1, 0, 2] : [2, 1, 3, 0, 4])[index % rows]; // middle first, then the wings
    const cols = Math.ceil(Math.max(size, index + 1) / rows);
    const depth = 150 + col * Math.min(150, 520 / Math.max(1, cols - 1));
    const mid = (rows - 1) / 2;
    const spacing = rows === 3 ? 190 : 135;
    const x = defends({ swapped }, team) === "left" ? CX - depth : CX + depth;
    const y = CY + (row - mid) * spacing + (col % 2 && row !== mid ? spacing / 2 : 0);
    return { x: clamp(x, PITCH.L + HALF + 10, PITCH.R - HALF - 10), y: clamp(y, PITCH.T + HALF + 10, PITCH.B - HALF - 10) };
  }

  // `team` ("left"/"right") puts a new player on that side; otherwise they join the smaller team.
  function addPlayer(m, id, name, team) {
    const existing = m.players.get(id);
    if (existing) {
      existing.name = name || existing.name;
      existing.connected = true;
      existing.goneFor = 0;
      return existing;
    }
    if (m.players.size >= (m.maxPlayers || MAX_PLAYERS)) return null;
    const counts = teamCounts(m);
    if (!TEAMS[team]) team = counts.left <= counts.right ? "left" : "right";
    const index = counts[team];
    const spot = formationSpot(team, index, m.swapped, index + 1);
    const player = {
      id,
      name: name || "Player",
      team,
      number: m.nextNumber[team]++,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      facing: kickoffFacing(m, team),
      input: { x: 0, y: 0 },
      kickSeen: null,
      dash: 0,
      cooldown: 0,
      kickedBall: false,
      star: 0,
      big: 0,
      flower: 0,
      brick: 0,
      coma: 0,
      scale: 1,
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
    const spot = formationSpot(team, teamCounts(m)[team] - 1, m.swapped);
    Object.assign(p, { x: spot.x, y: spot.y, vx: 0, vy: 0, dash: 0, facing: kickoffFacing(m, team) });
    return p;
  }

  function disconnectPlayer(m, id) {
    const p = m.players.get(id);
    if (!p) return;
    p.connected = false;
    p.input = { x: 0, y: 0 };
  }

  function removePlayer(m, id) {
    if (!m.players.delete(id)) return false;
    if (m.ball.lastTouch === id) m.ball.lastTouch = null;
    return true;
  }

  // Empty the pitch (between championship matches); jersey numbers start again from 1. Power-ups end first, so
  // their holders' phones hear about it.
  function clearPlayers(m) {
    clearPowerUps(m);
    m.players.clear();
    m.ball.lastTouch = null;
    m.nextNumber = { left: 1, right: 1 };
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
    if (p.cooldown > 0 || !p.connected || p.coma > 0) return false;
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
    const size = teamCounts(m);
    const players = [...m.players.values()].sort((a, b2) => a.joinedAt - b2.joinedAt);
    for (const p of players) {
      const spot = formationSpot(p.team, index[p.team]++, m.swapped, size[p.team]);
      Object.assign(p, { x: spot.x, y: spot.y, vx: 0, vy: 0, dash: 0, facing: kickoffFacing(m, p.team) });
    }
    m.phase = "play";
    m.phaseTime = 0;
  }

  // Fresh game: score 0–0, original ends, and (for timed games) wait for the first player to start the clock —
  // or, with `kickOff`, start the clock right now.
  function newGame(m, kickOff) {
    m.score = { left: 0, right: 0 };
    m.swapped = false;
    clearPowerUps(m);
    resetKickoff(m);
    m.events.push({ type: "reset" });
    if (!m.length) setPeriod(m, "free", 0);
    else if (kickOff) setPeriod(m, "first", m.length / 2);
    else setPeriod(m, "pre", 0);
  }

  const resetMatch = (m) => newGame(m, false);
  const startGame = (m) => newGame(m, true);

  function setGameLength(m, minutes) {
    m.length = GAME_LENGTHS.includes(minutes) || CUP_LENGTHS.includes(minutes) ? minutes * 60 : 0;
    resetMatch(m);
  }

  function setPeriod(m, period, clock) {
    m.period = period;
    m.clock = clock;
    m.events.push({ type: "period", period, clock, score: { ...m.score } });
  }

  // Advance the game clock. The clock stops during goal celebrations, like added time.
  function stepPeriod(m, dt) {
    switch (m.period) {
      case "pre":
        if (!m.manual && m.players.size > 0) setPeriod(m, "first", m.length / 2);
        break;
      case "first":
      case "second":
        if (m.phase !== "play") break;
        m.clock = Math.max(0, m.clock - dt);
        if (m.clock > 0) break;
        if (m.period === "first") {
          // Half time: (maybe) swap ends and kick off the second half straight away.
          clearPowerUps(m);
          if (m.swapEnds) m.swapped = !m.swapped;
          resetKickoff(m);
          setPeriod(m, "second", m.length / 2);
        } else if (m.score.left === m.score.right) {
          setPeriod(m, "golden", 0);
        } else {
          Object.assign(m.ball, { x: CX, y: CY, vx: 0, vy: 0, lastTouch: null });
          endGame(m);
        }
        break;
      case "full":
        m.clock = Math.max(0, m.clock - dt);
        if (m.clock === 0 && !m.manual) resetMatch(m);
        break;
    }
  }

  // The winning golden goal stays in the net for its celebration; full time otherwise resets the ball first.
  function endGame(m) {
    clearPowerUps(m);
    setPeriod(m, "full", FULLTIME_SHOW);
  }

  function collidePlayerBall(m, p) {
    if (m.powered && p.star <= 0) return;
    const b = m.ball;
    const h = half(p);
    const cx = clamp(b.x, p.x - h, p.x + h);
    const cy = clamp(b.y, p.y - h, p.y + h);
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
      if (h - Math.abs(ox) < h - Math.abs(oy)) {
        nx = Math.sign(ox) || 1;
        ny = 0;
        overlap = h - Math.abs(ox) + BALL_R;
      } else {
        nx = 0;
        ny = Math.sign(oy) || 1;
        overlap = h - Math.abs(oy) + BALL_R;
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

  // Circle push + velocity exchange, weighted by mass so a big player shoves others around.
  // Star players are ghosts: they pass straight through everyone. Hard hits emit a "bump" event.
  function collidePlayers(m, a, c) {
    if (a.star > 0 || c.star > 0) return;
    const r = (half(a) + half(c)) * 0.95;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= r || d < 1e-6) return;
    const nx = dx / d;
    const ny = dy / d;
    const ma = mass(a);
    const mc = mass(c);
    const overlap = r - d;
    a.x -= nx * overlap * (mc / (ma + mc));
    a.y -= ny * overlap * (mc / (ma + mc));
    c.x += nx * overlap * (ma / (ma + mc));
    c.y += ny * overlap * (ma / (ma + mc));
    const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
    if (vn < 0) {
      if (vn < -BUMP_SPEED) m.events.push({ type: "bump", a: a.id, b: c.id, speed: -vn, x: (a.x + c.x) / 2 });
      const j = (-1.3 * vn) / (1 / ma + 1 / mc);
      a.vx -= (j / ma) * nx;
      a.vy -= (j / ma) * ny;
      c.vx += (j / mc) * nx;
      c.vy += (j / mc) * ny;
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

  function constrainBall(m, b) {
    const gh = mouthAt(m, b.x < CX ? "left" : "right");
    const inMouth = Math.abs(b.y - CY) < gh;
    const inGoal = inMouth && (b.x < PITCH.L || b.x > PITCH.R);

    if (inGoal) {
      // Inside the net: back wall and side netting.
      const back = b.x < PITCH.L ? PITCH.L - GOAL_DEPTH + BALL_R : PITCH.R + GOAL_DEPTH - BALL_R;
      if ((b.x < PITCH.L && b.x < back) || (b.x > PITCH.R && b.x > back)) {
        b.x = back;
        b.vx *= -0.3;
      }
      if (b.y < CY - gh + BALL_R) {
        b.y = CY - gh + BALL_R;
        b.vy = Math.abs(b.vy) * 0.3;
      } else if (b.y > CY + gh - BALL_R) {
        b.y = CY + gh - BALL_R;
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
    for (const end of ["left", "right"]) {
      const px = end === "left" ? PITCH.L : PITCH.R;
      bounceOffPost(b, px, CY - mouthAt(m, end));
      bounceOffPost(b, px, CY + mouthAt(m, end));
    }
  }

  function checkGoal(m) {
    const b = m.ball;
    const gh = mouthAt(m, b.x < CX ? "left" : "right");
    if (b.y - BALL_R < CY - gh || b.y + BALL_R > CY + gh) return;
    let team = null;
    if (b.x + BALL_R < PITCH.L && b.x - BALL_R >= PITCH.L - GOAL_DEPTH) team = teamAt(m, "right");
    else if (b.x - BALL_R > PITCH.R && b.x + BALL_R <= PITCH.R + GOAL_DEPTH) team = teamAt(m, "left");
    if (!team) return;
    const scorer = b.lastTouch ? m.players.get(b.lastTouch) : null;
    const ownGoal = Boolean(scorer && scorer.team !== team);
    const points = scorer && !ownGoal && scorer.flower > 0 ? m.flowerPoints : 1;
    m.score[team] += points;
    m.events.push({
      type: "goal",
      team,
      scorerId: scorer ? scorer.id : null,
      scorerName: scorer ? scorer.name : null,
      ownGoal,
      points,
      score: { ...m.score },
    });
    m.phase = "goal";
    m.phaseTime = 0;
    if (m.period === "golden") endGame(m);
  }

  const starGap = (m) => STAR_GAP_MIN + m.rand() * (STAR_GAP_MAX - STAR_GAP_MIN);
  const turkeyGap = (m) => TURKEY_GAP_MIN + m.rand() * (TURKEY_GAP_MAX - TURKEY_GAP_MIN);
  const itemGap = (m, kind) => ITEMS[kind].gapMin + m.rand() * (ITEMS[kind].gapMax - ITEMS[kind].gapMin);

  function clearPowerUps(m) {
    m.star = null;
    for (const p of m.players.values()) {
      if (p.star > 0) m.events.push({ type: "star-end", id: p.id });
      p.star = 0;
    }
    m.powered = false;
    m.starIn = starGap(m);
    for (const [kind, item] of Object.entries(ITEMS)) {
      m[kind] = null;
      m[`${kind}In`] = itemGap(m, kind);
      for (const p of m.players.values()) {
        if (p[item.field] > 0) m.events.push({ type: `${kind}-end`, id: p.id });
        p[item.field] = 0;
      }
    }
    m.turkey = null;
    m.turkeyIn = turkeyGap(m);
    for (const p of m.players.values()) {
      if (p.coma > 0) m.events.push({ type: "coma-end", id: p.id });
      p.coma = 0;
    }
  }

  // Switch one Mayhem power on or off; switching it off clears it from the pitch (powers already held run out).
  function setPower(m, kind, on) {
    if (!POWERS.includes(kind)) return;
    m.powers[kind] = Boolean(on);
    if (!on && m[kind]) {
      m[kind] = null;
      m.events.push({ type: `${kind}-gone` });
    }
  }

  function setFlowerPoints(m, points) {
    m.flowerPoints = FLOWER_CHOICES.includes(points) ? points : FLOWER_POINTS;
  }

  function setMayhem(m, on) {
    m.mayhem = Boolean(on);
    clearPowerUps(m);
  }

  const randomSpot = (m, margin) => ({
    x: PITCH.L + 160 + m.rand() * (PITCH.R - PITCH.L - 320),
    y: PITCH.T + margin + m.rand() * (PITCH.B - PITCH.T - margin * 2),
  });

  function spawnStar(m) {
    const a = m.rand() * Math.PI * 2;
    m.star = {
      ...randomSpot(m, 80),
      vx: Math.cos(a) * STAR_SPEED,
      vy: Math.sin(a) * STAR_SPEED,
      age: 0,
    };
    m.events.push({ type: "star-spawn", x: m.star.x, y: m.star.y });
  }

  function stepStar(m, dt, list) {
    if (!m.mayhem || !m.powers.star || m.phase !== "play" || !playing(m)) return;
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
      if (touches(p, s.x, s.y, STAR_R)) {
        p.star = STAR_POWER;
        m.star = null;
        m.powered = true;
        m.starIn = starGap(m);
        m.events.push({ type: "star-get", id: p.id, name: p.name, x: s.x, y: s.y });
        return;
      }
    }
  }

  // Mushrooms, flowers and bricks sprout in place and wait to be picked up.
  function stepItem(m, dt, list, kind) {
    if (!m.mayhem || !m.powers[kind] || m.phase !== "play" || !playing(m)) return;
    const item = ITEMS[kind];
    const it = m[kind];
    if (!it) {
      if (list.some((p) => p[item.field] > 0)) return;
      m[`${kind}In`] -= dt;
      if (m[`${kind}In`] <= 0) {
        m[kind] = { ...randomSpot(m, 70), age: 0 };
        m.events.push({ type: `${kind}-spawn`, x: m[kind].x, y: m[kind].y });
      }
      return;
    }
    it.age += dt;
    if (it.age >= item.life) {
      m[kind] = null;
      m[`${kind}In`] = itemGap(m, kind);
      m.events.push({ type: `${kind}-gone` });
      return;
    }
    for (const p of list) {
      if (!p.connected || !m.players.has(p.id)) continue;
      if (touches(p, it.x, it.y, item.r)) {
        p[item.field] = item.power;
        m[kind] = null;
        m[`${kind}In`] = itemGap(m, kind);
        m.events.push({ type: `${kind}-get`, id: p.id, name: p.name, x: it.x, y: it.y });
        return;
      }
    }
  }

  // The turkey: wanders in fits and starts, bolts from the nearest players, steers clear of the walls.
  function stepTurkey(m, dt, list) {
    if (!m.mayhem || !m.powers.turkey || m.phase !== "play" || !playing(m)) return;
    const tk = m.turkey;
    if (!tk) {
      if (list.some((p) => p.coma > 0)) return;
      m.turkeyIn -= dt;
      if (m.turkeyIn <= 0) {
        const a = m.rand() * Math.PI * 2;
        m.turkey = { ...randomSpot(m, 90), vx: 0, vy: 0, heading: a, pause: 0, age: 0, scared: false, hop: 0, flap: 0 };
        m.events.push({ type: "turkey-spawn", x: m.turkey.x, y: m.turkey.y });
      }
      return;
    }
    tk.age += dt;
    if (tk.age >= TURKEY_LIFE) {
      m.turkey = null;
      m.turkeyIn = turkeyGap(m);
      m.events.push({ type: "turkey-gone" });
      return;
    }
    for (const p of list) {
      if (!p.connected || !m.players.has(p.id)) continue;
      if (touches(p, tk.x, tk.y, TURKEY_R)) {
        m.turkey = null;
        m.turkeyIn = turkeyGap(m);
        const victims = [];
        for (const q of m.players.values()) {
          if (q.team === p.team) continue;
          q.coma = COMA_POWER;
          victims.push(q.id);
        }
        m.events.push({ type: "turkey-get", id: p.id, name: p.name, team: p.team, victims, x: tk.x, y: tk.y });
        return;
      }
    }
    // Run from everyone close by (nearer = scarier), otherwise potter about, pecking now and then.
    let fx = 0;
    let fy = 0;
    let near = null;
    for (const p of list) {
      const dx = tk.x - p.x;
      const dy = tk.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < TURKEY_SCARE && d > 1e-6) {
        const w = (TURKEY_SCARE - d) / TURKEY_SCARE;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
      }
      if (!near || d < near.d) near = { d, dx, dy, p };
    }
    tk.hop = Math.max(0, tk.hop - dt);
    tk.flap = Math.max(0, tk.flap - dt);
    if (near && near.d < TURKEY_HOP_NEAR + half(near.p) && tk.hop === 0) {
      // Flutter-hop: burst sideways (to whichever side has more room), away from the nearest player.
      const d = near.d || 1;
      let side = m.rand() < 0.5 ? 1 : -1;
      const sx = (-near.dy / d) * side;
      const sy = (near.dx / d) * side;
      if ((sy < 0 && tk.y < PITCH.T + 150) || (sy > 0 && tk.y > PITCH.B - 150) || (sx < 0 && tk.x < PITCH.L + 150) || (sx > 0 && tk.x > PITCH.R - 150)) side = -side;
      const ax = (-near.dy / d) * side * 0.8 + (near.dx / d) * 0.6;
      const ay = (near.dx / d) * side * 0.8 + (near.dy / d) * 0.6;
      const a = Math.hypot(ax, ay) || 1;
      tk.vx = (ax / a) * TURKEY_HOP;
      tk.vy = (ay / a) * TURKEY_HOP;
      tk.hop = TURKEY_HOP_GAP;
      tk.flap = 0.35;
      m.events.push({ type: "turkey-hop", x: tk.x, y: tk.y });
    }
    const margin = 120;
    const wall = (v, lo, hi) => (v < lo + margin ? (lo + margin - v) / margin : v > hi - margin ? -(v - (hi - margin)) / margin : 0);
    const wx = wall(tk.x, PITCH.L, PITCH.R);
    const wy = wall(tk.y, PITCH.T, PITCH.B);
    let tx;
    let ty;
    tk.scared = Math.hypot(fx, fy) > 0.05;
    if (tk.scared) {
      // Bolt away, jinking a little, and turn along the walls rather than into them.
      const ax = fx + wx * 1.4 + (m.rand() - 0.5) * 0.5;
      const ay = fy + wy * 1.4 + (m.rand() - 0.5) * 0.5;
      const a = Math.hypot(ax, ay) || 1;
      tx = (ax / a) * TURKEY_FLEE;
      ty = (ay / a) * TURKEY_FLEE;
      tk.heading = Math.atan2(ty, tx);
      tk.pause = 0;
    } else {
      tk.pause -= dt;
      if (tk.pause < -1.2 - m.rand() * 2) tk.pause = 0.4 + m.rand() * 0.7; // stop to peck
      tk.heading += (m.rand() - 0.5) * 6 * dt + (wx || wy ? Math.sign(Math.sin(Math.atan2(wy, wx) - tk.heading)) * 3 * dt : 0);
      const sp = tk.pause > 0 ? 0 : TURKEY_SPEED;
      tx = Math.cos(tk.heading) * sp;
      ty = Math.sin(tk.heading) * sp;
    }
    const kk = tk.flap > 0 ? 0 : Math.min(1, 9 * dt); // mid-hop it just flies
    tk.vx += (tx - tk.vx) * kk;
    tk.vy += (ty - tk.vy) * kk;
    tk.x += tk.vx * dt;
    tk.y += tk.vy * dt;
    const r = TURKEY_R + 6;
    if (tk.x < PITCH.L + r || tk.x > PITCH.R - r) {
      tk.vx *= -0.5;
      tk.heading = Math.PI - tk.heading;
    }
    if (tk.y < PITCH.T + r || tk.y > PITCH.B - r) {
      tk.vy *= -0.5;
      tk.heading = -tk.heading;
    }
    tk.x = clamp(tk.x, PITCH.L + r, PITCH.R - r);
    tk.y = clamp(tk.y, PITCH.T + r, PITCH.B - r);
  }

  function step(m, dtRaw) {
    const dt = clamp(dtRaw, 0, 0.05);
    m.t += dt;
    m.phaseTime += dt;
    const k = Math.min(1, RESPONSE * dt);
    stepPeriod(m, dt);

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
      for (const [kind, item] of Object.entries(ITEMS)) {
        if (p[item.field] > 0) {
          p[item.field] = Math.max(0, p[item.field] - dt);
          if (p[item.field] === 0) m.events.push({ type: `${kind}-end`, id: p.id });
        }
      }
      if (p.coma > 0) {
        p.coma = Math.max(0, p.coma - dt);
        if (p.coma === 0) m.events.push({ type: "coma-end", id: p.id });
      }
      const target = p.big > 0 ? BIG_SCALE : 1;
      p.scale += (target - p.scale) * Math.min(1, GROW_RATE * dt);
      if (Math.abs(target - p.scale) < 0.002) p.scale = target;
      p.dash = Math.max(0, p.dash - dt);
      // While dashing, momentum wins; otherwise ease toward the stick (sluggish on purpose).
      const kk = p.dash > 0 ? k * 0.15 : k;
      const top = MAX_SPEED * (p.coma > 0 ? COMA_SLOW : 1); // a food coma slows you right down
      p.vx += (p.input.x * top - p.vx) * kk;
      p.vy += (p.input.y * top - p.vy) * kk;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (Math.hypot(p.vx, p.vy) > 25) p.facing = Math.atan2(p.vy, p.vx);
      const h = half(p);
      const minX = PITCH.L + h;
      const maxX = PITCH.R - h;
      const minY = PITCH.T + h;
      const maxY = PITCH.B - h;
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
    stepMouths(m, dt);
    stepStar(m, dt, list);
    for (const kind of Object.keys(ITEMS)) stepItem(m, dt, list, kind);
    stepTurkey(m, dt, list);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) collidePlayers(m, list[i], list[j]);

    // Substep the ball so fast shots don't tunnel through players or posts.
    const sub = Math.max(1, Math.ceil((Math.hypot(m.ball.vx, m.ball.vy) * dt) / (BALL_R * 0.8)));
    for (let s = 0; s < sub; s++) {
      stepBall(m, dt / sub);
      if (m.phase === "play") {
        // Whoever touches the ball last in a substep wins a scrum, so rotate the order: nobody gets a standing edge
        // just for joining later.
        const n = list.length;
        m.turn = (m.turn + 1) % Math.max(1, n);
        for (let i = 0; i < n; i++) {
          const p = list[(m.turn + i) % n];
          if (m.players.has(p.id)) collidePlayerBall(m, p);
        }
      }
      // Player contact can displace the ball through a wall, so constrain it last.
      constrainBall(m, m.ball);
    }

    if (m.phase === "play" && playing(m)) checkGoal(m);
    else if (m.phase === "goal" && m.phaseTime >= (m.goalPause || GOAL_PAUSE)) resetKickoff(m);
    else if (m.period === "pre" && (m.ball.x + BALL_R < PITCH.L || m.ball.x - BALL_R > PITCH.R)) {
      // Warm-up shots don't count; the ball pops back to the centre spot.
      Object.assign(m.ball, { x: CX, y: CY, vx: 0, vy: 0, lastTouch: null });
    }
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
    SHROOM_R,
    SHROOM_LIFE,
    BIG_POWER,
    BIG_SCALE,
    SHROOM_GAP_MIN,
    SHROOM_GAP_MAX,
    FLOWER_R,
    FLOWER_LIFE,
    FLOWER_POWER,
    FLOWER_POINTS,
    FLOWER_CHOICES,
    TURKEY_R,
    TURKEY_LIFE,
    TURKEY_SPEED,
    TURKEY_FLEE,
    TURKEY_SCARE,
    TURKEY_GAP_MIN,
    TURKEY_GAP_MAX,
    COMA_POWER,
    COMA_SLOW,
    POWERS,
    FLOWER_GAP_MIN,
    FLOWER_GAP_MAX,
    BRICK_R,
    BRICK_LIFE,
    BRICK_POWER,
    BRICK_SHRINK,
    BRICK_GROW,
    BRICK_GAP_MIN,
    BRICK_GAP_MAX,
    DISCONNECT_GRACE,
    BUMP_SPEED,
    TEAMS,
    GAME_LENGTHS,
    CUP_LENGTHS,
    FULLTIME_SHOW,
    defends,
    teamAt,
    mouthAt,
    setGameLength,
    createMatch,
    addPlayer,
    removePlayer,
    clearPlayers,
    setTeam,
    setMayhem,
    setFlowerPoints,
    setPower,
    disconnectPlayer,
    sanitizeInput,
    setInput,
    kick,
    step,
    resetKickoff,
    resetMatch,
    startGame,
    formationSpot,
    drainEvents,
  };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.match = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
