const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/cup.js");

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ids = (n, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, "0")}`);
const phases = (cup) => C.drainEvents(cup).filter((e) => e.type === "phase").map((e) => e.phase);

function lobby(n, { size = 4, merge = false, picks = [] } = {}) {
  const cup = C.createCup({ size, theme: "feast", merge, rand: seeded(7) });
  const people = ids(n);
  people.forEach((id, i) => {
    C.join(cup, id, `P${i}`);
    if (picks[i] !== undefined) C.pick(cup, id, picks[i]);
  });
  return { cup, people };
}

// Play the current tie: warm-up runs out, then the given score.
function play(cup, a, b) {
  C.step(cup, C.NEXT_SHOW);
  assert.equal(cup.phase, "match");
  return C.finish(cup, a, b);
}

test("lobby: pick and switch freely; latecomers pick once, from the teams still in it", () => {
  const { cup, people } = lobby(4);
  assert.equal(C.pick(cup, people[0], 2), true);
  assert.equal(C.pick(cup, people[0], 1), true);
  assert.equal(cup.members.get(people[0]).team, 1);
  assert.equal(C.pick(cup, people[0], 4), false, "only 4 teams");
  assert.equal(C.pick(cup, people[0], 1.5), false);
  assert.equal(C.pick(cup, "nobody", 1), false);
  people.forEach((id, i) => C.pick(cup, id, i));
  C.start(cup);
  C.join(cup, "late00001", "Late");
  assert.equal(C.pick(cup, people[1], 0), false, "teams are locked once it starts");
  C.skip(cup);
  play(cup, 1, 0);
  const out = cup.teams.findIndex((t) => t.out);
  assert.equal(C.pick(cup, "late00001", out), false, "can't join a beaten team");
  const alive = cup.teams.findIndex((t) => !t.out);
  assert.equal(C.pick(cup, "late00001", alive), true);
  assert.equal(C.pick(cup, "late00001", alive === 0 ? 1 : 0), false, "latecomers pick once");
  assert.equal(cup.members.get("late00001").home, alive);
});

test("starting needs a player per team", () => {
  const { cup, people } = lobby(3);
  assert.equal(C.needed(cup), 1);
  assert.equal(C.start(cup), null);
  assert.equal(cup.phase, "lobby");
  C.leave(cup, people[0]);
  assert.equal(C.needed(cup), 2, "only connected phones count");
  C.join(cup, people[0], "P0");
  C.join(cup, "extra0001", "X");
  assert.equal(C.needed(cup), 0);
  assert.ok(C.start(cup));
  assert.equal(cup.phase, "draw");
});

test("start evens the teams: early pickers stay, late pickers and the undecided fill the gaps", () => {
  // Five pick the Turkeys, two the Pies, one never picks.
  const { cup, people } = lobby(8, { picks: [0, 0, 1, 0, 0, 1, 0] });
  const moves = C.start(cup);
  const team = (i) => cup.members.get(people[i]).team;
  const counts = [0, 0, 0, 0];
  for (const p of cup.members.values()) counts[p.team]++;
  assert.deepEqual(counts, [2, 2, 2, 2]);
  assert.deepEqual([team(0), team(1)], [0, 0], "the first two Turkeys stay");
  assert.deepEqual([team(2), team(5)], [1, 1], "the Pies are untouched");
  assert.deepEqual(moves.map((m) => m.name).sort(), ["P3", "P4", "P6", "P7"]);
  assert.equal(moves.find((m) => m.name === "P7").from, null);
  for (const p of cup.members.values()) assert.equal(p.home, p.team);
});

test("uneven numbers: the busiest teams get the extra players", () => {
  const { cup } = lobby(6, { picks: [2, 2, 2, 3, 3, 0] });
  C.start(cup);
  const counts = [0, 0, 0, 0];
  for (const p of cup.members.values()) counts[p.team]++;
  assert.deepEqual(counts.slice().sort(), [1, 1, 2, 2]);
  assert.equal(counts[2], 2);
  assert.equal(counts[3], 2);
});

test("the draw: 4 teams play semi-finals then a final; 8 teams start with quarter-finals", () => {
  const four = lobby(4).cup;
  C.start(four);
  assert.deepEqual(four.rounds.map((r) => r.length), [2, 1]);
  assert.deepEqual(four.rounds[0].flatMap((t) => [t.a, t.b]).sort(), [0, 1, 2, 3]);
  assert.deepEqual([C.label(four, 0, 0), C.label(four, 0, 1), C.label(four, 1, 0)], ["Semi-final 1", "Semi-final 2", "Final"]);
  const eight = lobby(8, { size: 8 }).cup;
  C.start(eight);
  assert.deepEqual(eight.rounds.map((r) => r.length), [4, 2, 1]);
  assert.equal(C.label(eight, 0, 3), "Quarter-final 4");
});

test("a whole championship: draw, warm-ups, ties, final and champion", () => {
  const { cup } = lobby(8);
  C.start(cup);
  C.drainEvents(cup);
  C.step(cup, C.DRAW_SHOW - 0.5);
  assert.equal(cup.phase, "draw");
  C.step(cup, 1);
  assert.equal(cup.phase, "next");
  const sf1 = C.current(cup);
  assert.equal(sf1.label, "Semi-final 1");
  assert.deepEqual(C.onPitch(cup), sf1);
  const done1 = play(cup, 2, 1);
  assert.equal(done1.w, sf1.a);
  assert.equal(cup.phase, "result");
  assert.deepEqual(C.onPitch(cup).label, "Semi-final 1", "the finished tie stays on the pitch for its result");
  assert.equal(cup.teams[sf1.b].out, true);
  C.step(cup, C.RESULT_SHOW);
  assert.equal(cup.phase, "next");
  const sf2 = C.current(cup);
  assert.equal(sf2.label, "Semi-final 2");
  play(cup, 0, 3);
  C.step(cup, C.RESULT_SHOW);
  const final = C.current(cup);
  assert.equal(final.label, "Final");
  assert.deepEqual([final.a, final.b], [sf1.a, sf2.b]);
  play(cup, 1, 2);
  assert.equal(cup.champion, sf2.b);
  C.step(cup, C.RESULT_SHOW);
  assert.equal(cup.phase, "champion");
  assert.equal(C.onPitch(cup).label, "Final");
  assert.deepEqual(phases(cup), ["next", "match", "result", "next", "match", "result", "next", "match", "result", "champion"]);
  C.step(cup, 999);
  assert.equal(cup.phase, "champion", "the champion stays up until a new championship");
});

test("skip jumps ahead; replay sends a tie back to its warm-up", () => {
  const { cup } = lobby(4);
  C.start(cup);
  assert.equal(C.skip(cup), true);
  assert.equal(cup.phase, "next");
  C.skip(cup);
  assert.equal(cup.phase, "match");
  assert.equal(C.skip(cup), false, "can't skip a match");
  assert.equal(C.replay(cup), true);
  assert.equal(cup.phase, "next");
  assert.equal(cup.timer, C.NEXT_SHOW);
  assert.equal(C.current(cup).label, "Semi-final 1");
});

test("a team with nobody here at kickoff gives the other a walkover", () => {
  const { cup, people } = lobby(4, { picks: [0, 1, 2, 3] });
  C.start(cup);
  C.skip(cup);
  const t = C.current(cup);
  for (const id of people) if (cup.members.get(id).team === t.b) C.leave(cup, id);
  C.skip(cup);
  assert.equal(cup.phase, "result");
  const done = cup.rounds[0][0];
  assert.equal(done.w, t.a);
  assert.equal(done.wo, true);
});

test("the warm-up countdown waits while a team has nobody here, then carries on", () => {
  const { cup, people } = lobby(4, { picks: [0, 1, 2, 3] });
  C.start(cup);
  C.skip(cup);
  const t = C.current(cup);
  const away = people.find((id) => cup.members.get(id).team === t.b);
  C.leave(cup, away);
  assert.deepEqual(C.missing(cup), [t.b]);
  C.step(cup, C.NEXT_SHOW + 120);
  assert.equal(cup.phase, "next", "no kickoff (and no walkover) on the clock");
  assert.ok(cup.timer >= C.WAIT_BACK);
  C.join(cup, away, "back");
  assert.deepEqual(C.missing(cup), []);
  const left = cup.timer;
  C.step(cup, left - 0.5);
  assert.equal(cup.phase, "next");
  C.step(cup, 1);
  assert.equal(cup.phase, "match");
});

test("a level score is settled by a coin toss", () => {
  const { cup } = lobby(4);
  C.start(cup);
  C.skip(cup);
  C.skip(cup);
  const t = C.finish(cup, 1, 1);
  assert.ok(t.w === t.a || t.w === t.b);
});

test("everyone plays the final: beaten teams join the team that knocked them out", () => {
  const { cup, people } = lobby(8, { merge: true, picks: [0, 0, 1, 1, 2, 2, 3, 3] });
  C.start(cup);
  C.skip(cup);
  const sf1 = C.current(cup);
  play(cup, 3, 0);
  assert.equal(cup.teams[sf1.b].into, sf1.a);
  const onWinner = people.filter((id) => cup.members.get(id).team === sf1.a);
  assert.equal(onWinner.length, 4);
  C.skip(cup);
  play(cup, 1, 0);
  C.skip(cup);
  const final = C.current(cup);
  const inFinal = people.filter((id) => [final.a, final.b].includes(cup.members.get(id).team));
  assert.equal(inFinal.length, 8, "all eight are in the final");
  const merged = people.find((id) => cup.members.get(id).home === sf1.b);
  assert.match(C.note(cup, merged), /You've joined the/);
  assert.equal(C.pick(cup, "late00001", sf1.b), false);
});

test("goals count toward the Golden Boot only during matches", () => {
  const { cup, people } = lobby(4);
  C.goal(cup, people[0]);
  assert.deepEqual(C.topScorers(cup), []);
  C.start(cup);
  C.skip(cup);
  C.skip(cup);
  C.goal(cup, people[0]);
  C.goal(cup, people[1]);
  C.goal(cup, people[1]);
  C.goal(cup, null);
  assert.deepEqual(C.topScorers(cup), [{ id: people[1], name: "P1", goals: 2 }]);
  C.goal(cup, people[0]);
  assert.equal(C.topScorers(cup).length, 2, "ties share the boot");
});

test("a new championship keeps the teams and forgets people who left", () => {
  const { cup, people } = lobby(4, { merge: true, picks: [0, 1, 2, 3] });
  C.start(cup);
  C.skip(cup);
  play(cup, 1, 0);
  C.leave(cup, people[3]);
  C.restart(cup);
  assert.equal(cup.phase, "lobby");
  assert.equal(cup.members.size, 3);
  for (const id of people.slice(0, 3)) assert.equal(cup.members.get(id).team, cup.members.get(id).home, "back on their own team");
  assert.ok(cup.teams.every((t) => !t.out && t.into === null));
  assert.deepEqual([cup.rounds, cup.champion, cup.goals], [[], null, {}]);
});

test("team count and names change only in the lobby", () => {
  const { cup, people } = lobby(8, { size: 8, picks: [0, 7] });
  assert.equal(C.configure(cup, { size: 4, theme: "sky" }), true);
  assert.equal(cup.teams.length, 4);
  assert.equal(cup.members.get(people[1]).team, null, "picks for teams that no longer exist are cleared");
  assert.equal(cup.members.get(people[0]).team, 0);
  assert.equal(C.teamLabel(cup, 0), "🌞 Suns");
  C.start(cup);
  assert.equal(C.configure(cup, { size: 8, merge: true }), false);
  assert.equal(cup.size, 4);
  assert.equal(cup.merge, true, "merge can change any time");
});

test("save and load: a tie that was being played restarts from its warm-up", () => {
  const { cup, people } = lobby(4, { picks: [0, 1, 2, 3] });
  C.start(cup);
  C.skip(cup);
  play(cup, 2, 0);
  C.skip(cup);
  C.skip(cup);
  C.goal(cup, people[0]);
  assert.equal(cup.phase, "match");
  const copy = C.load(JSON.parse(JSON.stringify(C.save(cup))));
  assert.equal(copy.phase, "next");
  assert.equal(copy.timer, C.NEXT_SHOW);
  assert.deepEqual(C.current(copy), C.current(cup));
  assert.deepEqual(copy.goals, cup.goals);
  assert.ok([...copy.members.values()].every((p) => !p.connected));
  assert.equal(copy.members.get(people[2]).team, cup.members.get(people[2]).team);
  assert.equal(C.load({ v: 2 }), null);
  assert.equal(C.load(null), null);
  const lobbyCopy = C.load(JSON.parse(JSON.stringify(C.save(lobby(2, { picks: [1, 3] }).cup))));
  assert.equal(lobbyCopy.phase, "lobby");
  assert.equal(lobbyCopy.members.size, 2, "lobby picks survive a reload");
});

test("notes tell each phone where they stand", () => {
  const { cup, people } = lobby(4, { picks: [0, 1, 2, 3] });
  C.join(cup, "late00001", "Late");
  assert.match(C.note(cup, people[0]), /Switch any time before kickoff/);
  assert.match(C.note(cup, "late00001"), /Pick a team/);
  C.start(cup);
  C.skip(cup);
  const t = C.current(cup);
  const inIt = people.find((id) => cup.members.get(id).team === t.a);
  const waiting = people.find((id) => ![t.a, t.b].includes(cup.members.get(id).team));
  assert.match(C.note(cup, inIt), /You're on! Semi-final 1/);
  assert.match(C.note(cup, waiting), /Next up for the .*: Semi-final 2 vs the/);
  play(cup, 1, 0);
  const loser = people.find((id) => cup.members.get(id).team === t.b);
  assert.match(C.note(cup, loser), /are out/);
  assert.match(C.note(cup, inIt), /Through to the Final! Waiting for your opponent/);
  C.skip(cup);
  play(cup, 0, 1);
  C.skip(cup);
  const final = C.current(cup);
  play(cup, final.a === t.a ? 2 : 0, final.a === t.a ? 0 : 2);
  assert.equal(cup.phase, "result");
  assert.equal(C.note(cup, inIt), "🏆 You're the champions!", "as soon as the final whistle goes");
  assert.match(C.note(cup, waiting), /🏆 The .* are the champions!/);
});

test("bots: first to move when teams are evened up, and remembered across a reload", () => {
  const cup = C.createCup({ size: 4, theme: "feast", rand: seeded(3) });
  C.join(cup, "bot-a", "🤖 Gizmo", { bot: true });
  C.join(cup, "bot-b", "🤖 Bolt", { bot: true });
  C.pick(cup, "bot-a", 0);
  C.pick(cup, "bot-b", 0);
  C.join(cup, "human001", "Ken");
  C.pick(cup, "human001", 0);
  C.join(cup, "human002", "Ann");
  // Team 0 has two bots that picked before Ken; evening up must move a bot, not Ken.
  C.start(cup);
  assert.equal(cup.members.get("human001").team, 0);
  const moved = cup.moves.map((mv) => mv.id);
  assert.ok(moved.some((id) => id.startsWith("bot-")) && !moved.includes("human001"));
  const copy = C.load(JSON.parse(JSON.stringify(C.save(cup))));
  assert.equal(copy.members.get("bot-a").bot, true);
  assert.equal(copy.members.get("human001").bot, false);
});

test("remove drops a member", () => {
  const { cup, people } = lobby(3);
  assert.equal(C.remove(cup, people[2]), true);
  assert.equal(cup.members.has(people[2]), false);
  assert.equal(C.remove(cup, people[2]), false);
});
