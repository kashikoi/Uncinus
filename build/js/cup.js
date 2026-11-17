/* Uncinus — championship ("cup") mode. Pure logic (no DOM) so it can run under node --test.
   Phones huddle into a handful of themed teams in a lobby; at kickoff the teams are evened up and drawn into a
   knockout bracket (4 teams: semi-finals + final; 8: quarter-finals too). The host plays each tie on the pitch
   and reports the score; winners go through until a champion is crowned. Optionally, beaten teams join the
   team that knocked them out, so everyone is in the final. */
(function (root) {
  "use strict";

  const SIZES = [4, 8];
  const THEMES = {
    feast: [
      { name: "Turkeys", emoji: "🦃", color: "#92400e" },
      { name: "Pies", emoji: "🥧", color: "#7c3aed" },
      { name: "Pumpkins", emoji: "🎃", color: "#ea580c" },
      { name: "Corn", emoji: "🌽", color: "#15803d" },
      { name: "Maples", emoji: "🍁", color: "#dc2626" },
      { name: "Yams", emoji: "🍠", color: "#db2777" },
      { name: "Spuds", emoji: "🥔", color: "#0e7490" },
      { name: "Acorns", emoji: "🌰", color: "#475569" },
    ],
    sky: [
      { name: "Suns", emoji: "🌞", color: "#d97706" },
      { name: "Moons", emoji: "🌙", color: "#4f46e5" },
      { name: "Stars", emoji: "⭐", color: "#0d9488" },
      { name: "Bolts", emoji: "⚡", color: "#7c3aed" },
      { name: "Rainbows", emoji: "🌈", color: "#db2777" },
      { name: "Snowmen", emoji: "⛄", color: "#0284c7" },
      { name: "Cyclones", emoji: "🌀", color: "#475569" },
      { name: "Comets", emoji: "🌠", color: "#dc2626" },
    ],
  };
  const PHASES = ["lobby", "draw", "next", "match", "result", "champion"];
  const DRAW_SHOW = 10; // seconds the draw stays up
  const NEXT_SHOW = 30; // warm-up before each kickoff
  const RESULT_SHOW = 8; // full-time result before moving on
  const WAIT_BACK = 10; // seconds of warm-up left when a missing team comes back

  // Thanksgiving names in November, sky names the rest of the year.
  const defaultTheme = (date = new Date()) => (date.getMonth() === 10 ? "feast" : "sky");

  function createCup({ size = 4, theme = defaultTheme(), merge = false, rand = Math.random } = {}) {
    const cup = {
      phase: "lobby",
      size: SIZES.includes(size) ? size : 4,
      theme: THEMES[theme] ? theme : "sky",
      merge: Boolean(merge),
      teams: [],
      members: new Map(),
      rounds: [],
      at: { r: 0, i: 0 }, // the tie being (or about to be) played
      last: null, // the tie that finished most recently
      timer: 0,
      goals: {},
      moves: [],
      champion: null,
      seq: 0,
      events: [],
      rand,
    };
    cup.teams = freshTeams(cup.size);
    return cup;
  }

  const freshTeams = (size) => Array.from({ length: size }, (_, id) => ({ id, out: false, into: null }));
  const teamInfo = (cup, t) => (Number.isInteger(t) && THEMES[cup.theme][t] ? { id: t, ...THEMES[cup.theme][t] } : null);
  const teamLabel = (cup, t) => {
    const info = teamInfo(cup, t);
    return info ? `${info.emoji} ${info.name}` : "?";
  };
  const live = (cup) => [...cup.members.values()].filter((p) => p.connected);
  const liveOn = (cup, t) => live(cup).filter((p) => p.team === t);

  function setPhase(cup, phase, timer = 0) {
    const prev = cup.phase;
    cup.phase = phase;
    cup.timer = timer;
    cup.events.push({ type: "phase", phase, prev });
  }

  // ---------- People ----------
  function join(cup, id, name) {
    let p = cup.members.get(id);
    if (!p) {
      p = { id, name: name || "Player", team: null, home: null, seq: ++cup.seq, pickSeq: 0, connected: true };
      cup.members.set(id, p);
    } else {
      p.name = name || p.name;
      p.connected = true;
    }
    return p;
  }

  function leave(cup, id) {
    const p = cup.members.get(id);
    if (p) p.connected = false;
  }

  // In the lobby anyone can pick (and switch) freely. Once the cup is under way, latecomers pick once, from the
  // teams still in it.
  function pick(cup, id, team) {
    const p = cup.members.get(id);
    if (!p || !Number.isInteger(team) || team < 0 || team >= cup.size) return false;
    if (cup.phase === "lobby") {
      if (p.team !== team) {
        p.team = team;
        p.pickSeq = ++cup.seq;
      }
      return true;
    }
    if (cup.phase === "champion" || p.team !== null || cup.teams[team].out) return false;
    p.team = team;
    p.home = team;
    return true;
  }

  // The commissioner — whoever joined first and is still here — can start things from their phone.
  function vip(cup) {
    let best = null;
    for (const p of cup.members.values()) if (p.connected && (!best || p.seq < best.seq)) best = p;
    return best ? best.id : null;
  }

  const needed = (cup) => Math.max(0, cup.size - live(cup).length);

  // ---------- Starting: even teams + the draw ----------
  // Every team ends up within one player of every other. Teams keep their earliest pickers; the latest pickers
  // on crowded teams, and anyone who never picked, fill the gaps. Returns who moved.
  function balance(cup) {
    const people = live(cup).sort((a, b) => a.seq - b.seq);
    const T = cup.size;
    const base = Math.floor(people.length / T);
    const extra = people.length % T;
    const groups = Array.from({ length: T }, () => []);
    const pool = [];
    for (const p of people) (p.team !== null && p.team < T ? groups[p.team] : pool).push(p);
    for (const g of groups) g.sort((a, b) => a.pickSeq - b.pickSeq);
    const order = groups.map((_, t) => t).sort((a, b) => groups[b].length - groups[a].length || a - b);
    const cap = [];
    order.forEach((t, k) => (cap[t] = base + (k < extra ? 1 : 0)));
    for (let t = 0; t < T; t++) while (groups[t].length > cap[t]) pool.push(groups[t].pop());
    const moves = [];
    for (let t = 0; t < T; t++) {
      while (groups[t].length < cap[t]) {
        const p = pool.shift();
        moves.push({ id: p.id, name: p.name, from: p.team, to: t });
        p.team = t;
        groups[t].push(p);
      }
    }
    for (const p of cup.members.values()) p.home = p.team;
    return moves;
  }

  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Round 0 pairs the drawn teams; later rounds wait for winners.
  function buildRounds(order) {
    const rounds = [];
    const first = [];
    for (let i = 0; i < order.length; i += 2) first.push({ a: order[i], b: order[i + 1], w: null, s: null, wo: false });
    rounds.push(first);
    for (let n = first.length / 2; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, w: null, s: null, wo: false })));
    return rounds;
  }

  function start(cup) {
    if (cup.phase !== "lobby" || needed(cup) > 0) return null;
    cup.teams = freshTeams(cup.size);
    cup.moves = balance(cup);
    cup.rounds = buildRounds(shuffle(cup.teams.map((t) => t.id), cup.rand));
    cup.at = { r: 0, i: 0 };
    cup.last = null;
    cup.goals = {};
    cup.champion = null;
    setPhase(cup, "draw", DRAW_SHOW);
    return cup.moves;
  }

  // ---------- Ties ----------
  function label(cup, r, i) {
    const fromEnd = cup.rounds.length - 1 - r;
    if (fromEnd === 0) return "Final";
    return `${fromEnd === 1 ? "Semi-final" : "Quarter-final"} ${i + 1}`;
  }

  function tie(cup, at) {
    if (!at || at.r >= cup.rounds.length) return null;
    const t = cup.rounds[at.r][at.i];
    return { ...t, r: at.r, i: at.i, label: label(cup, at.r, at.i) };
  }

  const current = (cup) => tie(cup, cup.at);
  // The tie whose players belong on the pitch right now: the upcoming one while warming up and playing,
  // the one that just finished while its result is up.
  const onPitch = (cup) =>
    cup.phase === "next" || cup.phase === "match" ? current(cup) : cup.phase === "result" || cup.phase === "champion" ? tie(cup, cup.last) : null;

  // Record a finished tie. A level score (only possible by walkover or a host reset) is settled by a coin toss.
  function finish(cup, sa, sb, walkover = false) {
    if (cup.phase !== "match") return null;
    const { r, i } = cup.at;
    const t = cup.rounds[r][i];
    let w = sa > sb ? t.a : sb > sa ? t.b : null;
    if (w === null) w = cup.rand() < 0.5 ? t.a : t.b;
    const l = w === t.a ? t.b : t.a;
    Object.assign(t, { w, s: [sa, sb], wo: walkover });
    cup.teams[l].out = true;
    if (cup.merge) {
      cup.teams[l].into = w;
      for (const p of cup.members.values()) if (p.team === l) p.team = w;
    }
    if (r + 1 < cup.rounds.length) cup.rounds[r + 1][Math.floor(i / 2)][i % 2 ? "b" : "a"] = w;
    else cup.champion = w;
    cup.last = { r, i };
    cup.at = i + 1 < cup.rounds[r].length ? { r, i: i + 1 } : { r: r + 1, i: 0 };
    setPhase(cup, "result", RESULT_SHOW);
    return tie(cup, cup.last);
  }

  // Kick off the current tie — unless a team has nobody here, in which case the other goes through.
  function kickoff(cup) {
    const t = current(cup);
    const a = liveOn(cup, t.a).length;
    const b = liveOn(cup, t.b).length;
    if (a && b) {
      setPhase(cup, "match");
      return;
    }
    cup.phase = "match";
    finish(cup, a ? 1 : 0, b ? 1 : 0, true);
  }

  function advance(cup) {
    if (cup.phase === "draw") setPhase(cup, "next", NEXT_SHOW);
    else if (cup.phase === "next") kickoff(cup);
    else if (cup.phase === "result") setPhase(cup, cup.champion !== null ? "champion" : "next", cup.champion !== null ? 0 : NEXT_SHOW);
  }

  // Teams in the upcoming tie with nobody connected (their phones locked, or the big screen moved rooms).
  function missing(cup) {
    const t = cup.phase === "next" ? current(cup) : null;
    return t ? [t.a, t.b].filter((team) => !liveOn(cup, team).length) : [];
  }

  function step(cup, dt) {
    if (cup.phase !== "draw" && cup.phase !== "next" && cup.phase !== "result") return;
    // Never kick off on the clock without both teams: hold the countdown. (The commissioner can still kick off
    // now, which gives the team that's here a walkover.)
    if (missing(cup).length) {
      cup.timer = Math.max(cup.timer, WAIT_BACK);
      return;
    }
    cup.timer = Math.max(0, cup.timer - dt);
    if (cup.timer === 0) advance(cup);
  }

  // "Go now": skip the rest of the draw, warm-up or result.
  function skip(cup) {
    if (cup.phase !== "draw" && cup.phase !== "next" && cup.phase !== "result") return false;
    cup.timer = 0;
    advance(cup);
    return true;
  }

  // Play the current tie again from the warm-up (e.g. the host reset the game mid-match).
  function replay(cup) {
    if (cup.phase !== "match") return false;
    setPhase(cup, "next", NEXT_SHOW);
    return true;
  }

  function goal(cup, scorerId) {
    if (cup.phase !== "match" || !scorerId) return;
    cup.goals[scorerId] = (cup.goals[scorerId] || 0) + 1;
  }

  // Golden Boot: everyone tied on the most goals.
  function topScorers(cup) {
    const most = Math.max(0, ...Object.values(cup.goals));
    if (!most) return [];
    return Object.keys(cup.goals)
      .filter((id) => cup.goals[id] === most)
      .map((id) => ({ id, name: cup.members.has(id) ? cup.members.get(id).name : "?", goals: most }));
  }

  // Back to the lobby for another championship with the same teams (anyone can switch before it starts).
  // `prune` drops people who aren't connected any more.
  function toLobby(cup, prune) {
    for (const [id, p] of cup.members) {
      if (prune && !p.connected) cup.members.delete(id);
      else if (p.home !== null && p.home < cup.size) p.team = p.home;
    }
    cup.teams = freshTeams(cup.size);
    cup.rounds = [];
    cup.at = { r: 0, i: 0 };
    cup.last = null;
    cup.goals = {};
    cup.moves = [];
    cup.champion = null;
  }

  function restart(cup) {
    toLobby(cup, true);
    setPhase(cup, "lobby");
  }

  // Team count and names can change only in the lobby; "everyone plays the final" applies from the next result.
  function configure(cup, { size, theme, merge } = {}) {
    if (merge !== undefined) cup.merge = Boolean(merge);
    if (cup.phase !== "lobby") return false;
    if (SIZES.includes(size) && size !== cup.size) {
      cup.size = size;
      cup.teams = freshTeams(size);
      for (const p of cup.members.values()) if (p.team !== null && p.team >= size) p.team = null;
    }
    if (THEMES[theme]) cup.theme = theme;
    return true;
  }

  // Where a phone stands, in a sentence.
  function note(cup, id) {
    const p = cup.members.get(id);
    const mine = p ? p.team : null;
    const team = teamLabel(cup, mine);
    if (cup.phase === "lobby") return mine === null ? "Pick a team — huddle up with your crew!" : "Switch any time before kickoff. Teams are evened up when it starts.";
    if (mine === null) return cup.phase === "champion" ? "That's the championship!" : "Pick a team to jump in.";
    if (cup.champion !== null) return mine === cup.champion ? "🏆 You're the champions!" : `🏆 The ${teamLabel(cup, cup.champion)} are the champions!`;
    if (cup.teams[mine].out) return `The ${team} are out — cheer on the others!`;
    const joined = p.home !== null && p.home !== mine ? `You've joined the ${team}! ` : "";
    const now = onPitch(cup);
    if (now && cup.phase !== "result" && (now.a === mine || now.b === mine)) return `${joined}You're on! ${now.label}.`;
    for (let r = cup.at.r; r < cup.rounds.length; r++) {
      for (let i = 0; i < cup.rounds[r].length; i++) {
        const t = cup.rounds[r][i];
        if (t.w !== null) continue;
        if (t.a === mine || t.b === mine) {
          const vs = t.a === mine ? t.b : t.a;
          const next = vs === null ? `Through to the ${label(cup, r, i)}! Waiting for your opponent.` : `Next up for the ${team}: ${label(cup, r, i)} vs the ${teamLabel(cup, vs)}.`;
          return joined + next;
        }
      }
    }
    return `${joined}Go ${team}!`;
  }

  // ---------- Saving (the big screen may reload mid-championship) ----------
  function save(cup) {
    return {
      v: 1,
      phase: cup.phase,
      size: cup.size,
      theme: cup.theme,
      merge: cup.merge,
      teams: cup.teams,
      members: [...cup.members.values()].map(({ id, name, team, home, seq, pickSeq }) => ({ id, name, team, home, seq, pickSeq })),
      rounds: cup.rounds,
      at: cup.at,
      last: cup.last,
      goals: cup.goals,
      moves: cup.moves,
      champion: cup.champion,
      seq: cup.seq,
    };
  }

  // Everyone starts disconnected (they reconnect through the relay). A tie that was being played restarts from
  // its warm-up; a result that was showing moves straight on.
  function load(data, rand = Math.random) {
    try {
      if (!data || data.v !== 1 || !PHASES.includes(data.phase) || !SIZES.includes(data.size) || !THEMES[data.theme]) return null;
      const cup = createCup({ size: data.size, theme: data.theme, merge: data.merge, rand });
      if (!Array.isArray(data.teams) || data.teams.length !== cup.size) return null;
      cup.teams = data.teams.map((t, id) => ({ id, out: Boolean(t.out), into: Number.isInteger(t.into) ? t.into : null }));
      for (const m of data.members || []) {
        if (!m || typeof m.id !== "string") continue;
        const team = Number.isInteger(m.team) && m.team < cup.size ? m.team : null;
        const home = Number.isInteger(m.home) && m.home < cup.size ? m.home : null;
        cup.members.set(m.id, { id: m.id, name: String(m.name || "Player"), team, home, seq: m.seq | 0, pickSeq: m.pickSeq | 0, connected: false });
      }
      cup.rounds = Array.isArray(data.rounds) && data.rounds.every((r) => Array.isArray(r) && r.every((t) => t && typeof t === "object")) ? data.rounds : [];
      cup.at = data.at && Number.isInteger(data.at.r) && Number.isInteger(data.at.i) ? data.at : { r: 0, i: 0 };
      cup.last = data.last && Number.isInteger(data.last.r) && Number.isInteger(data.last.i) ? data.last : null;
      cup.goals = data.goals && typeof data.goals === "object" ? data.goals : {};
      cup.moves = Array.isArray(data.moves) ? data.moves : [];
      cup.champion = Number.isInteger(data.champion) ? data.champion : null;
      cup.seq = data.seq | 0;
      let phase = data.phase;
      if (phase === "match") phase = "next";
      if (phase === "result") phase = cup.champion !== null ? "champion" : "next";
      if ((phase === "draw" || phase === "next") && !current(cup)) phase = cup.champion !== null ? "champion" : "lobby";
      if (phase === "champion" && cup.champion === null) phase = "lobby";
      if (phase === "lobby" && data.phase !== "lobby") toLobby(cup, false);
      setPhase(cup, phase, phase === "draw" ? DRAW_SHOW : phase === "next" ? NEXT_SHOW : 0);
      return cup;
    } catch {
      return null;
    }
  }

  function drainEvents(cup) {
    const out = cup.events;
    cup.events = [];
    return out;
  }

  const api = {
    SIZES,
    THEMES,
    DRAW_SHOW,
    NEXT_SHOW,
    RESULT_SHOW,
    WAIT_BACK,
    defaultTheme,
    createCup,
    teamInfo,
    teamLabel,
    join,
    leave,
    pick,
    vip,
    needed,
    missing,
    start,
    label,
    current,
    onPitch,
    finish,
    step,
    skip,
    replay,
    goal,
    topScorers,
    restart,
    configure,
    note,
    save,
    load,
    drainEvents,
  };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.cup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
