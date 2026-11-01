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
