const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/match.js");

const run = (m, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) M.step(m, 1 / 60);
};

test("players alternate onto the smaller team with jersey numbers", () => {
  const m = M.createMatch();
  const ps = ["aaaaaa", "bbbbbb", "cccccc", "dddddd", "eeeeee"].map((id) => M.addPlayer(m, id, id));
  assert.deepEqual(ps.map((p) => p.team), ["left", "right", "left", "right", "left"]);
  assert.deepEqual(ps.map((p) => p.number), [1, 1, 2, 2, 3]);
  for (const p of ps) {
    if (p.team === "left") assert.ok(p.x < M.CX);
    else assert.ok(p.x > M.CX);
  }
});

test("re-adding an id reconnects the same player", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Ann");
  M.disconnectPlayer(m, "aaaaaa");
  assert.equal(M.addPlayer(m, "aaaaaa", "Annie"), p);
  assert.equal(p.connected, true);
  assert.equal(m.players.size, 1);
});

test("caps at MAX_PLAYERS", () => {
  const m = M.createMatch();
  for (let i = 0; i < M.MAX_PLAYERS; i++) assert.ok(M.addPlayer(m, `p${i}xxxxx`, `P${i}`));
  assert.equal(M.addPlayer(m, "extraxx", "X"), null);
});

test("kick counter triggers one dash per press, with cooldown", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Ann");
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 0 });
  assert.equal(p.dash, 0, "first counter value just syncs");
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 1 });
  assert.ok(p.dash > 0 && p.vx > 400);
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 1 });
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 2 });
  assert.equal(M.drainEvents(m).filter((e) => e.type === "dash").length, 1, "cooldown blocks the second press");
  run(m, M.KICK_COOLDOWN + 0.05);
  M.setInput(m, "aaaaaa", { x: 0, y: 0, k: 3 });
  assert.equal(M.drainEvents(m).filter((e) => e.type === "dash").length, 1);
});

test("running into the ball pushes it", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Ann");
  Object.assign(p, { x: M.CX - 120, y: M.CY });
  M.setInput(m, "aaaaaa", { x: 1, y: 0 });
  run(m, 1.2);
  assert.ok(m.ball.vx > 50, `ball moving right (${m.ball.vx})`);
  assert.equal(m.ball.lastTouch, "aaaaaa");
});

test("a dash-kick launches the ball much harder", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Ann");
  Object.assign(p, { x: M.CX - 60, y: M.CY });
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 0 });
  M.setInput(m, "aaaaaa", { x: 1, y: 0, k: 1 });
  run(m, 0.15);
  assert.ok(m.ball.vx > 700, `kicked (${m.ball.vx})`);
  assert.ok(M.drainEvents(m).some((e) => e.type === "kick"));
});

test("ball bounces off side walls and the touchlines", () => {
  const m = M.createMatch();
  Object.assign(m.ball, { x: M.CX, y: M.PITCH.T + 40, vx: 0, vy: -600 });
  run(m, 0.2);
  assert.ok(m.ball.vy > 0 && m.ball.y >= M.PITCH.T + M.BALL_R);
  Object.assign(m.ball, { x: M.PITCH.L + 40, y: M.PITCH.T + 60, vx: -600, vy: 0 });
  run(m, 0.2);
  assert.ok(m.ball.vx > 0, "outside the goal mouth the end wall bounces");
  assert.deepEqual(m.score, { left: 0, right: 0 });
});

for (const side of [-1, 1]) {
  for (const y of [M.PITCH.T + 80, M.PITCH.B - 80]) {
    test(`pushing against the ${side < 0 ? "left" : "right"} end wall at y=${y} cannot score`, () => {
      const m = M.createMatch();
      const p = M.addPlayer(m, "aaaaaa", "Ann");
      const line = side < 0 ? M.PITCH.L : M.PITCH.R;
      Object.assign(p, { x: line - side * (M.HALF + 40), y });
      Object.assign(m.ball, { x: line - side * M.BALL_R, y });
      M.setInput(m, p.id, { x: side, y: 0, k: 0 });

      for (let frame = 0; frame < 360; frame++) {
        if (frame === 120) M.setInput(m, p.id, { x: side, y: 0, k: 1 });
        M.step(m, 1 / 120);
        assert.equal(m.phase, "play", "pushing the wall must not trigger a goal");
        assert.ok(m.ball.x >= M.PITCH.L + M.BALL_R && m.ball.x <= M.PITCH.R - M.BALL_R,
          "the ball stays inside the end wall");
        assert.equal(m.ball.y, y, "the ball must not teleport into the net");
      }
      assert.deepEqual(m.score, { left: 0, right: 0 });
      assert.ok(!M.drainEvents(m).some((e) => e.type === "goal"));
    });
  }
}

for (const side of [-1, 1]) {
  test(`pushing into the ${side < 0 ? "left" : "right"} net scores only with the whole ball inside`, () => {
    const m = M.createMatch();
    const p = M.addPlayer(m, "aaaaaa", "Ann");
    const line = side < 0 ? M.PITCH.L : M.PITCH.R;
    Object.assign(p, { x: line - side * (M.HALF + 40), y: M.CY });
    Object.assign(m.ball, { x: line - side * M.BALL_R, y: M.CY });
    M.setInput(m, p.id, { x: side, y: 0 });

    for (let frame = 0; frame < 360 && m.phase === "play"; frame++) M.step(m, 1 / 120);
    assert.equal(m.phase, "goal");
    assert.deepEqual(m.score, side < 0 ? { left: 0, right: 1 } : { left: 1, right: 0 });
    const depth = side * (m.ball.x - line);
    assert.ok(depth > M.BALL_R && depth + M.BALL_R <= M.GOAL_DEPTH);
    assert.ok(Math.abs(m.ball.y - M.CY) + M.BALL_R <= M.GOAL_HALF);
    assert.equal(M.drainEvents(m).filter((e) => e.type === "goal").length, 1);
  });

  test(`the whole ball must cross the ${side < 0 ? "left" : "right"} goal line`, () => {
    const m = M.createMatch();
    const line = side < 0 ? M.PITCH.L : M.PITCH.R;
    m.ball.x = line + side * (M.BALL_R - 1);
    M.step(m, 1 / 120);
    assert.equal(m.phase, "play", "part of the ball is still on the pitch");
    m.ball.x = line + side * (M.BALL_R + 1);
    M.step(m, 1 / 120);
    assert.equal(m.phase, "goal");
  });
}

test("a shot into the right goal scores for left, then kickoff resets", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Ann");
  Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: "aaaaaa" });
  run(m, 0.3);
  assert.deepEqual(m.score, { left: 1, right: 0 });
  assert.equal(m.phase, "goal");
  const goal = M.drainEvents(m).find((e) => e.type === "goal");
  assert.equal(goal.team, "left");
  assert.equal(goal.scorerName, "Ann");
  assert.equal(goal.ownGoal, false);
  assert.ok(m.ball.x > M.PITCH.R && m.ball.x < M.PITCH.R + M.GOAL_DEPTH, "ball rests in the net");
  run(m, M.GOAL_PAUSE + 0.1);
  assert.equal(m.phase, "play");
  assert.equal(m.ball.x, M.CX);
  assert.ok(p.x < M.CX, "players reset to their own half");
});

test("own goals are credited to the other team", () => {
  const m = M.createMatch();
  M.addPlayer(m, "aaaaaa", "Ann"); // left team
  Object.assign(m.ball, { x: M.PITCH.L + 60, y: M.CY + 20, vx: -700, vy: 0, lastTouch: "aaaaaa" });
  run(m, 0.3);
  assert.deepEqual(m.score, { left: 0, right: 1 });
  assert.equal(M.drainEvents(m).find((e) => e.type === "goal").ownGoal, true);
});

test("goalposts deflect the ball", () => {
  const m = M.createMatch();
  Object.assign(m.ball, { x: M.PITCH.R - 80, y: M.CY - M.GOAL_HALF, vx: 600, vy: 0 });
  run(m, 0.3);
  assert.ok(m.ball.vx < 0, "rebounded off the post");
  assert.deepEqual(m.score, { left: 0, right: 0 });
});

test("players shove each other and stay on the pitch", () => {
  const m = M.createMatch();
  const a = M.addPlayer(m, "aaaaaa", "A");
  const b = M.addPlayer(m, "bbbbbb", "B");
  Object.assign(a, { x: M.CX - 30, y: M.CY + 200 });
  Object.assign(b, { x: M.CX + 30, y: M.CY + 200 });
  run(m, 0.05);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= M.HALF * 1.8);
  M.setInput(m, "aaaaaa", { x: -1, y: -1 });
  run(m, 6);
  assert.ok(a.x >= M.PITCH.L + M.HALF && a.y >= M.PITCH.T + M.HALF);
});

test("players crashing into each other emit a bump; gentle leaning doesn't", () => {
  const m = M.createMatch();
  const a = M.addPlayer(m, "aaaaaa", "A");
  const b = M.addPlayer(m, "bbbbbb", "B");
  Object.assign(a, { x: M.CX - 30, y: M.CY + 200, vx: 0, vy: 0 });
  Object.assign(b, { x: M.CX + 30, y: M.CY + 200, vx: 0, vy: 0 });
  M.setInput(m, "aaaaaa", { x: 0.2, y: 0 });
  run(m, 1);
  assert.equal(M.drainEvents(m).filter((e) => e.type === "bump").length, 0);
  Object.assign(a, { x: M.CX - 200, vx: 330 });
  Object.assign(b, { x: M.CX + 200, vx: -330 });
  M.setInput(m, "aaaaaa", { x: 1, y: 0 });
  M.setInput(m, "bbbbbb", { x: -1, y: 0 });
  run(m, 1);
  const bumps = M.drainEvents(m).filter((e) => e.type === "bump");
  assert.ok(bumps.length >= 1);
  assert.deepEqual([bumps[0].a, bumps[0].b].sort(), ["aaaaaa", "bbbbbb"]);
});

test("fast balls don't tunnel through players", () => {
  const m = M.createMatch();
  const p = M.addPlayer(m, "aaaaaa", "Wall");
  Object.assign(p, { x: M.CX + 200, y: M.CY });
  Object.assign(m.ball, { x: M.CX, y: M.CY, vx: 1150, vy: 0 });
  run(m, 0.4);
  assert.ok(m.ball.x < p.x, "ball bounced back off the player");
});

test("disconnected players leave after the grace period; reset clears score", () => {
  const m = M.createMatch();
  M.addPlayer(m, "aaaaaa", "Ann");
  M.disconnectPlayer(m, "aaaaaa");
  run(m, M.DISCONNECT_GRACE + 0.5);
  assert.equal(m.players.size, 0);
  m.score.left = 3;
  M.resetMatch(m);
  assert.deepEqual(m.score, { left: 0, right: 0 });
});

test("setTeam moves a player to the chosen team's half with a new number", () => {
  const m = M.createMatch();
  const a = M.addPlayer(m, "aaaaaa", "Ann"); // left #1
  M.addPlayer(m, "bbbbbb", "Bob"); // right #1
  assert.equal(M.setTeam(m, "aaaaaa", "right"), a);
  assert.equal(a.team, "right");
  assert.equal(a.number, 2);
  assert.ok(a.x > M.CX);
  assert.equal(M.setTeam(m, "aaaaaa", "purple"), null);
  assert.equal(M.setTeam(m, "nobody", "left"), null);
  assert.equal(M.setTeam(m, "aaaaaa", "right").number, 2, "same team is a no-op");
});

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("mayhem spawns a star roughly once a minute, and it fades if nobody grabs it", () => {
  const m = M.createMatch();
  m.rand = seeded(3);
  run(m, M.STAR_GAP_MAX + 1);
  assert.equal(m.star, null, "no stars unless mayhem is on");
  M.setMayhem(m, true);
  const wait = m.starIn;
  assert.ok(wait >= M.STAR_GAP_MIN && wait <= M.STAR_GAP_MAX);
  let t = 0;
  for (; !m.star && t < M.STAR_GAP_MAX + 1; t += 1 / 60) M.step(m, 1 / 60);
  assert.ok(m.star, "a star appeared");
  assert.ok(Math.abs(t - wait) < 0.1, `on schedule (${t} vs ${wait})`);
  assert.ok(M.drainEvents(m).some((e) => e.type === "star-spawn"));
  assert.ok(m.star.x > M.PITCH.L && m.star.x < M.PITCH.R && m.star.y > M.PITCH.T && m.star.y < M.PITCH.B);
  run(m, M.STAR_LIFE + 0.1);
  assert.equal(m.star, null);
  assert.ok(M.drainEvents(m).some((e) => e.type === "star-gone"));
  M.setMayhem(m, false);
  run(m, M.STAR_GAP_MAX + 1);
  assert.equal(m.star, null);
});

function starMatch() {
  const m = M.createMatch();
  m.rand = seeded(5);
  const hero = M.addPlayer(m, "aaaaaa", "Hero");
  const foe = M.addPlayer(m, "bbbbbb", "Foe");
  M.setMayhem(m, true);
  m.star = { x: hero.x, y: hero.y, vx: 0, vy: 0, age: 0 };
  M.step(m, 1 / 120);
  return { m, hero, foe };
}

test("grabbing the star powers a player up for STAR_POWER seconds", () => {
  const { m, hero } = starMatch();
  assert.equal(m.star, null);
  assert.ok(hero.star > M.STAR_POWER - 0.1);
  assert.deepEqual(M.drainEvents(m).find((e) => e.type === "star-get").id, "aaaaaa");
  run(m, M.STAR_POWER + 0.1);
  assert.equal(hero.star, 0);
  assert.ok(M.drainEvents(m).some((e) => e.type === "star-end" && e.id === "aaaaaa"));
});

test("a star player ghosts straight through other players", () => {
  const { m, hero, foe } = starMatch();
  Object.assign(hero, { x: M.CX - 200, y: M.CY + 250, vx: 0, vy: 0 });
  Object.assign(foe, { x: M.CX - 190, y: M.CY + 250, vx: 0, vy: 0 });
  M.step(m, 1 / 120);
  assert.ok(Math.abs(hero.x - (M.CX - 200)) < 0.01 && Math.abs(foe.x - (M.CX - 190)) < 0.01, "nobody was pushed");
  // Run the hero right through a wall of defenders.
  Object.assign(foe, { x: M.CX - 100, y: M.CY + 250 });
  M.setInput(m, hero.id, { x: 1, y: 0 });
  run(m, 1.5);
  assert.ok(hero.x > foe.x + M.HALF * 2, `hero passed through (${hero.x} vs ${foe.x})`);
});

test("while someone has the star only they can touch the ball", () => {
  const { m, hero, foe } = starMatch();
  Object.assign(hero, { x: M.CX - 300, y: M.CY - 250 });
  Object.assign(foe, { x: M.CX + 200, y: M.CY });
  Object.assign(m.ball, { x: M.CX, y: M.CY, vx: 600, vy: 0 });
  run(m, 0.5);
  assert.ok(m.ball.x > foe.x, "ball passed straight through the foe");
  Object.assign(hero, { x: M.CX - 60, y: M.CY + 200, vx: 0, vy: 0 });
  Object.assign(m.ball, { x: M.CX, y: M.CY + 200, vx: -600, vy: 0 });
  run(m, 0.3);
  assert.ok(m.ball.vx > 0, "ball bounced off the star player");
  assert.equal(m.ball.lastTouch, "aaaaaa");
  run(m, M.STAR_POWER);
  Object.assign(foe, { x: M.CX + 200, y: M.CY, vx: 0, vy: 0 });
  Object.assign(m.ball, { x: M.CX, y: M.CY, vx: 600, vy: 0 });
  run(m, 0.5);
  assert.ok(m.ball.x < foe.x, "after the power ends everyone plays the ball again");
});

test("resetMatch and turning mayhem off end any star power", () => {
  const { m, hero } = starMatch();
  M.setMayhem(m, false);
  assert.equal(hero.star, 0);
  assert.equal(m.powered, false);
});

function shroomMatch() {
  const m = M.createMatch();
  m.rand = seeded(9);
  const big = M.addPlayer(m, "aaaaaa", "Big");
  const small = M.addPlayer(m, "bbbbbb", "Small");
  M.setMayhem(m, true);
  m.shroom = { x: big.x, y: big.y, age: 0 };
  M.step(m, 1 / 120);
  return { m, big, small };
}

test("mayhem sprouts a mushroom on schedule; it withers if nobody eats it", () => {
  const m = M.createMatch();
  m.rand = seeded(4);
  M.setMayhem(m, true);
  const wait = m.shroomIn;
  assert.ok(wait >= M.SHROOM_GAP_MIN && wait <= M.SHROOM_GAP_MAX);
  let t = 0;
  for (; !m.shroom && t < M.SHROOM_GAP_MAX + 1; t += 1 / 60) M.step(m, 1 / 60);
  assert.ok(m.shroom && Math.abs(t - wait) < 0.1);
  const { x, y } = m.shroom;
  run(m, 2);
  assert.deepEqual([m.shroom.x, m.shroom.y], [x, y], "mushrooms stay put");
  run(m, M.SHROOM_LIFE);
  assert.equal(m.shroom, null);
  assert.ok(M.drainEvents(m).some((e) => e.type === "shroom-gone"));
});

test("eating the mushroom grows a player BIG_SCALE times for BIG_POWER seconds", () => {
  const { m, big } = shroomMatch();
  assert.equal(m.shroom, null);
  assert.equal(M.drainEvents(m).find((e) => e.type === "shroom-get").id, "aaaaaa");
  run(m, 1.5);
  assert.ok(Math.abs(big.scale - M.BIG_SCALE) < 0.01, `grew (${big.scale})`);
  run(m, M.BIG_POWER);
  assert.equal(big.big, 0);
  assert.ok(Math.abs(big.scale - 1) < 0.01, `shrank back (${big.scale})`);
  assert.ok(M.drainEvents(m).some((e) => e.type === "shroom-end"));
});

test("a big player bulldozes a normal one", () => {
  const { m, big, small } = shroomMatch();
  run(m, 1.5);
  Object.assign(big, { x: M.CX - 300, y: M.CY, vx: 0, vy: 0 });
  Object.assign(small, { x: M.CX - 300 + M.HALF * M.BIG_SCALE + M.HALF, y: M.CY, vx: 0, vy: 0 });
  M.setInput(m, big.id, { x: 1, y: 0 });
  M.setInput(m, small.id, { x: -1, y: 0 });
  const start = big.x;
  run(m, 1.5);
  assert.ok(big.x - start > 150, `big player kept driving forward (${big.x - start})`);
  assert.ok(small.x > big.x, "small player was pushed ahead, not through");
});

test("a big player stays inside the pitch", () => {
  const { m, big } = shroomMatch();
  M.setInput(m, big.id, { x: -1, y: -1 });
  run(m, 5);
  const h = M.HALF * big.scale;
  assert.ok(big.x >= M.PITCH.L + h - 0.01 && big.y >= M.PITCH.T + h - 0.01);
});

function flowerMatch() {
  const m = M.createMatch();
  m.rand = seeded(11);
  const ann = M.addPlayer(m, "aaaaaa", "Ann"); // left, attacks the right goal
  M.setMayhem(m, true);
  m.flower = { x: ann.x, y: ann.y, age: 0 };
  M.step(m, 1 / 120);
  return { m, ann };
}

const shootRight = (m, id) => Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: id });

test("mayhem blooms a power flower on its own schedule", () => {
  const m = M.createMatch();
  m.rand = seeded(6);
  M.setMayhem(m, true);
  const wait = m.flowerIn;
  assert.ok(wait >= M.FLOWER_GAP_MIN && wait <= M.FLOWER_GAP_MAX);
  let t = 0;
  for (; !m.flower && t < M.FLOWER_GAP_MAX + 1; t += 1 / 60) M.step(m, 1 / 60);
  assert.ok(m.flower && Math.abs(t - wait) < 0.1);
  run(m, M.FLOWER_LIFE + 0.1);
  assert.equal(m.flower, null);
  assert.ok(M.drainEvents(m).some((e) => e.type === "flower-gone"));
});

test("with flower power, your goals count FLOWER_POINTS", () => {
  const { m, ann } = flowerMatch();
  assert.equal(m.flower, null);
  assert.ok(ann.flower > M.FLOWER_POWER - 0.1);
  assert.equal(M.drainEvents(m).find((e) => e.type === "flower-get").id, "aaaaaa");
  shootRight(m, "aaaaaa");
  run(m, 0.3);
  assert.deepEqual(m.score, { left: M.FLOWER_POINTS, right: 0 });
  assert.equal(M.drainEvents(m).find((e) => e.type === "goal").points, M.FLOWER_POINTS);
});

test("flower power doesn't multiply own goals, and wears off", () => {
  const { m } = flowerMatch();
  Object.assign(m.ball, { x: M.PITCH.L + 60, y: M.CY, vx: -700, vy: 0, lastTouch: "aaaaaa" });
  run(m, 0.3);
  assert.deepEqual(m.score, { left: 0, right: 1 });
  run(m, M.FLOWER_POWER);
  assert.ok(M.drainEvents(m).some((e) => e.type === "flower-end"));
  shootRight(m, "aaaaaa");
  run(m, 0.3);
  assert.deepEqual(m.score, { left: 1, right: 1 }, "back to a normal goal");
});

const runPlay = (m, seconds) => {
  // Step in 1/60 s chunks without letting goals pause the clock.
  for (let t = 0; t < seconds; t += 1 / 60) M.step(m, 1 / 60);
};
const periods = (m) => M.drainEvents(m).filter((e) => e.type === "period").map((e) => e.period);

test("no time limit by default: endless play with no clock", () => {
  const m = M.createMatch();
  M.addPlayer(m, "aaaaaa", "Ann");
  runPlay(m, 120);
  assert.equal(m.period, "free");
});

test("a timed game waits for the first player, then counts each half down", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  assert.equal(m.period, "pre");
  runPlay(m, 10);
  assert.equal(m.period, "pre", "clock doesn't start on an empty pitch");
  M.drainEvents(m);
  M.addPlayer(m, "aaaaaa", "Ann");
  M.step(m, 1 / 60);
  assert.equal(m.period, "first");
  assert.ok(Math.abs(m.clock - 150) < 0.05, `first half is 2:30 (${m.clock})`);
  runPlay(m, 60);
  assert.ok(Math.abs(m.clock - 90) < 0.1, `counting down (${m.clock})`);
  assert.deepEqual(periods(m), ["first"]);
});

test("half time: teams swap ends straight into the second-half kickoff", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann"); // left team, defends the left end
  const bob = M.addPlayer(m, "bbbbbb", "Bob");
  assert.equal(M.defends(m, "left"), "left");
  let t = 0;
  for (; m.period !== "second" && t < 200; t += 1 / 60) M.step(m, 1 / 60);
  assert.ok(Math.abs(t - 150) < 0.1, `second half starts right at 2:30 (${t})`);
  assert.ok(m.swapped);
  assert.ok(Math.abs(m.clock - 150) < 0.05);
  assert.equal(M.defends(m, "left"), "right", "blue now defends the right end");
  assert.ok(ann.x > M.CX && bob.x < M.CX, "kickoff on the new halves");
  assert.deepEqual([m.ball.x, m.ball.y], [M.CX, M.CY]);
  assert.deepEqual(periods(m), ["pre", "first", "second"]);
});

test("after the swap, goals still count for the team that attacked", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann"); // left team
  runPlay(m, 150.1);
  assert.equal(m.period, "second");
  // Blue now attacks the LEFT goal.
  Object.assign(m.ball, { x: M.PITCH.L + 60, y: M.CY, vx: -700, vy: 0, lastTouch: ann.id });
  runPlay(m, 0.3);
  assert.deepEqual(m.score, { left: 1, right: 0 });
  assert.equal(M.drainEvents(m).find((e) => e.type === "goal").ownGoal, false);
});

test("goal celebrations stop the clock", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann");
  runPlay(m, 1);
  const before = m.clock;
  Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: ann.id });
  runPlay(m, 0.3 + M.GOAL_PAUSE);
  assert.ok(before - m.clock < 0.5, `clock paused for the goal (${before - m.clock})`);
});

test("full time shows the result, then a new game starts by itself", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann");
  runPlay(m, 1);
  Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: ann.id });
  runPlay(m, 0.3 + M.GOAL_PAUSE);
  runPlay(m, 150 + 150);
  assert.equal(m.period, "full");
  const full = M.drainEvents(m).filter((e) => e.type === "period").at(-1);
  assert.deepEqual(full.score, { left: 1, right: 0 });
  // No goals at full time.
  Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: ann.id });
  runPlay(m, 1);
  assert.deepEqual(m.score, { left: 1, right: 0 });
  runPlay(m, M.FULLTIME_SHOW);
  assert.equal(m.period, "first");
  assert.deepEqual(m.score, { left: 0, right: 0 });
  assert.equal(m.swapped, false);
});

test("setGameLength only accepts the offered lengths", () => {
  const m = M.createMatch();
  M.setGameLength(m, 7);
  assert.equal(m.length, 0);
  assert.equal(m.period, "free");
  M.setGameLength(m, 30);
  assert.equal(m.length, 1800);
});

test("level at the end: next goal wins, with no clock", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann");
  M.addPlayer(m, "bbbbbb", "Bob");
  runPlay(m, 300.2);
  assert.equal(m.period, "golden");
  runPlay(m, 120);
  assert.equal(m.period, "golden", "no time limit until someone scores");
  M.drainEvents(m);
  // Blue attacks the left goal in the second half.
  Object.assign(m.ball, { x: M.PITCH.L + 60, y: M.CY, vx: -700, vy: 0, lastTouch: ann.id });
  runPlay(m, 0.3);
  assert.equal(m.period, "full");
  assert.deepEqual(m.score, { left: 1, right: 0 });
  const evs = M.drainEvents(m);
  assert.ok(evs.findIndex((e) => e.type === "goal") < evs.findIndex((e) => e.type === "period" && e.period === "full"));
  assert.deepEqual(evs.find((e) => e.period === "full").score, { left: 1, right: 0 });
  runPlay(m, M.FULLTIME_SHOW + 0.1);
  assert.equal(m.period, "first", "then a new game");
});

test("not level at the end: straight to full time", () => {
  const m = M.createMatch();
  M.setGameLength(m, 5);
  const ann = M.addPlayer(m, "aaaaaa", "Ann");
  runPlay(m, 1);
  Object.assign(m.ball, { x: M.PITCH.R - 60, y: M.CY, vx: 700, vy: 0, lastTouch: ann.id });
  runPlay(m, 0.3 + M.GOAL_PAUSE);
  runPlay(m, 300);
  assert.equal(m.period, "full");
});
