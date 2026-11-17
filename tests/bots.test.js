const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/match.js");
const B = require("../js/bots.js");

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function botMatch(sides, { skill = "normal", seed = 1, minutes = 0 } = {}) {
  const m = M.createMatch();
  m.rand = seeded(seed + 500);
  M.setGameLength(m, minutes);
  const brains = new Map();
  sides.forEach((side, i) => {
    const id = `bot-${i}`;
    M.addPlayer(m, id, id, side);
    brains.set(id, B.createBrain({ skill, rand: seeded(seed * 31 + i) }));
  });
  return { m, brains };
}

// Play `seconds` of game time with the bots driving; returns the goal events.
function play(m, brains, seconds) {
  const goals = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    B.drive(m, brains, 1 / 60);
    M.step(m, 1 / 120);
    M.step(m, 1 / 120);
    for (const ev of M.drainEvents(m)) if (ev.type === "goal") goals.push(ev);
  }
  return goals;
}

for (const side of ["left", "right"]) {
  test(`a bot on the ${side} team scores in the goal it attacks`, () => {
    const { m, brains } = botMatch([side]);
    const goals = play(m, brains, 12);
    assert.ok(goals.length >= 2, `scored ${goals.length}`);
    assert.ok(goals.every((g) => g.team === side && !g.ownGoal));
  });
}

test("after the half-time swap, bots attack the other end", () => {
  const { m, brains } = botMatch(["left"]);
  m.swapped = true;
  M.resetKickoff(m);
  const goals = play(m, brains, 12);
  assert.ok(goals.length >= 2 && goals.every((g) => g.team === "left" && !g.ownGoal));
  assert.ok(m.ball.x < M.CX || m.phase === "play", "the goals went in at the left end");
});

test("bots stand still at kickoff for a moment, during goal celebrations and at full time", () => {
  const { m, brains } = botMatch(["left", "right"], { skill: "hard" });
  const [a] = [...m.players.values()];
  B.drive(m, brains, 1 / 60);
  assert.deepEqual(a.input, { x: 0, y: 0 }, "a beat before charging at kickoff");
  play(m, brains, B.SKILLS.hard.hesitate[1] + 0.3);
  assert.ok(Math.hypot(a.input.x, a.input.y) > 0.3, "then off they go");
  m.phase = "goal";
  play(m, brains, 0.5);
  assert.deepEqual(a.input, { x: 0, y: 0 });
  m.phase = "play";
  m.period = "full";
  m.clock = 10; // the full-time result is showing
  play(m, brains, 0.5);
  assert.deepEqual(a.input, { x: 0, y: 0 });
});

test("bots only kick when their cooldown allows, like phones", () => {
  const { m, brains } = botMatch(["left", "right"], { skill: "hard" });
  let dashes = 0;
  for (let t = 0; t < 30; t += 1 / 60) {
    B.drive(m, brains, 1 / 60);
    M.step(m, 1 / 60);
    dashes += M.drainEvents(m).filter((e) => e.type === "dash").length;
  }
  assert.ok(dashes > 5, `they kick (${dashes})`);
  assert.ok(dashes <= 2 * (30 / M.KICK_COOLDOWN + 1), "never faster than the cooldown");
});

test("even bot teams make a game of it: goals at both ends, and neither side always wins", () => {
  const wins = { left: 0, right: 0 };
  let total = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { m, brains } = botMatch(["left", "left", "right", "right"], { seed, minutes: 2 });
    const goals = play(m, brains, 150);
    total += goals.length;
    if (m.score.left !== m.score.right) wins[m.score.left > m.score.right ? "left" : "right"]++;
  }
  assert.ok(total >= 12, `plenty of goals (${total})`);
  assert.ok(wins.left >= 1 && wins.right >= 1, `both sides win games (${JSON.stringify(wins)})`);
});

test("hard bots beat easy bots", () => {
  let hard = 0;
  let easy = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const m = M.createMatch();
    M.setGameLength(m, 2);
    const brains = new Map();
    ["left", "left", "right", "right"].forEach((side, i) => {
      M.addPlayer(m, `bot-${i}`, `bot-${i}`, side);
      brains.set(`bot-${i}`, B.createBrain({ skill: side === "left" ? "hard" : "easy", rand: seeded(seed * 7 + i) }));
    });
    play(m, brains, 150);
    hard += m.score.left;
    easy += m.score.right;
  }
  assert.ok(hard > easy * 1.5, `hard ${hard} vs easy ${easy}`);
});

test("bot names are unique, then numbered", () => {
  const taken = [];
  for (let i = 0; i < B.NAMES.length + 3; i++) taken.push(B.pickName(taken, seeded(i + 1)));
  assert.equal(new Set(taken).size, taken.length);
  assert.ok(taken.slice(B.NAMES.length).every((n) => / \d+$/.test(n)));
});
