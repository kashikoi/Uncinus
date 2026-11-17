/* Uncinus — host (the Mac screen). Owns the match, renders it, and talks to phones through the relay. */
(function () {
  "use strict";

  const U = window.Uncinus;
  const { util, match: M, face: F, sound: S, cup: C } = U;
  const ROOM_KEY = "uncinus_room";
  const KEYBOARD_ID = "keyboard";
  const TEAM_PICK_KEY = "uncinus_team_pick";
  const MAYHEM_KEY = "uncinus_mayhem";
  const LENGTH_KEY = "uncinus_length";
  const CUP_ON_KEY = "uncinus_cup_on";
  const CUP_KEY = "uncinus_cup"; // the championship in progress, so a reload of the big screen picks it back up
  const CUP_ROOM_KEY = "uncinus_cup_room"; // ...in the same room, so waiting phones reconnect by themselves
  const CUP_SETTINGS_KEY = "uncinus_cup_settings";
  const CUP_MAX_PLAYERS = 48; // the relay's room cap
  const CHEER_GAP = 0.5; // seconds between one phone's cheers
  const GO_GAP = 1200; // ms after a championship phase change during which "go" presses are ignored (double taps)
  const DEFAULT_LENGTH = 10;
  const PERIOD_LABEL = {
    pre: "Waiting for players", first: "1st half", second: "2nd half", golden: "⚡ Next goal wins", full: "Full time",
  };

  const el = {};
  const state = {
    room: null,
    relay: util.relayUrl(),
    link: null,
    match: M.createMatch(),
    faces: new Map(),
    faceAssembler: F.createFaceAssembler(),
    renderer: null,
    joinOpen: true,
    keyboard: false,
    keyboardKicks: 0,
    keys: new Set(),
    wakeLock: null,
    bannerTimer: null,
    starTimer: null,
    clockShown: "",
    countSaid: null,
    soundWasLocked: false,
    teamPick: false,
    cup: null, // the championship, while championship mode is on
    cupSettings: { size: 4, length: 4, theme: C.defaultTheme(), merge: false },
    cupSyncTimer: null,
    cupPitch: null, // which tie the pitch is set up for ("round:index")
    cupPhaseAt: 0,
    cupShown: "",
    cheers: new Map(),
    slowFrames: 0,
    avgFrame: 1 / 60,
    dprTrial: null,
    dprSettled: false,
    frameError: false,
  };

  const $ = (id) => document.getElementById(id);

  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not persisted; still applies for this session.
    }
  }

  function stored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // Phones the host knows about: on the pitch, or (in championship mode) waiting their turn.
  const knows = (id) => state.match.players.has(id) || Boolean(state.cup && state.cup.members.has(id));

  function joinUrl() {
    const url = new URL("play.html", location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", state.room);
    if (state.relay !== util.DEFAULT_RELAY) url.searchParams.set("relay", state.relay);
    return url.toString();
  }

  function shortPlayUrl() {
    const url = new URL("play.html", location.href);
    return `${url.host}${url.pathname}`;
  }

  // ---------- Room & relay ----------
  function startRoom(code) {
    state.room = util.isRoomCode(code) ? code : util.roomCode();
    sessionStorage.setItem(ROOM_KEY, state.room);
    if (state.cup) store(CUP_ROOM_KEY, state.room);
    for (const p of [...state.match.players.values()]) if (p.id !== KEYBOARD_ID) state.match.players.delete(p.id);
    // Championship teams are kept; everyone rejoins through the new code.
    if (state.cup) for (const p of state.cup.members.values()) p.connected = false;
    state.faces.clear();
    if (state.link) state.link.close();
    state.link = new U.Link({
      url: `${state.relay}/room/${state.room}?role=host`,
      onMessage: handleMessage,
      onStatus: renderStatus,
    });
    state.link.connect();
    renderJoinCard();
    renderRoster();
    if (state.cup) renderCup();
  }

  function sendTo(id, d) {
    if (id === KEYBOARD_ID || !state.link) return;
    state.link.send({ to: id, d });
  }

  function broadcast(d) {
    state.link && state.link.send({ to: "*", d });
  }

  function greet(id, name) {
    if (state.cup) {
      cupGreet(id, name);
      return;
    }
    // A phone that last saw a championship goes back to the normal pad.
    sendTo(id, { t: "cup", on: false });
    const p = M.addPlayer(state.match, id, name);
    if (!p) {
      sendTo(id, { t: "full" });
      return;
    }
    sendYou(p);
    sendTo(id, { t: "score", ...state.match.score });
    if (id !== KEYBOARD_ID && state.joinOpen && realPlayers().length === 1) setJoinOpen(false);
  }

  function sendYou(p) {
    const team = M.TEAMS[p.team];
    // `pick` tells the phone it may choose its colour; it asks once per join and lets players switch later.
    // `sides` says which end each colour defends right now (they swap at half time).
    sendTo(p.id, {
      t: "you", name: p.name, team: p.team, teamName: team.name, color: team.color, number: p.number,
      pick: state.teamPick && !state.cup, counts: teamCounts(),
      sides: { left: M.defends(state.match, "left"), right: M.defends(state.match, "right") },
    });
    sendTo(p.id, periodMessage());
  }

  function teamCounts() {
    const counts = { left: 0, right: 0 };
    for (const p of state.match.players.values()) counts[p.team]++;
    return counts;
  }

  function pickTeam(id, team) {
    if (!state.teamPick || state.cup) return;
    const p = M.setTeam(state.match, id, team);
    if (!p) return;
    sendYou(p);
    renderRoster();
  }

  function handleMessage(msg) {
    switch (msg.t) {
      case "welcome":
        for (const p of state.match.players.values()) if (p.id !== KEYBOARD_ID) M.disconnectPlayer(state.match, p.id);
        if (state.cup) for (const p of state.cup.members.values()) p.connected = false;
        for (const p of msg.players || []) greet(p.id, p.name);
        if (state.cup) scheduleCupSync();
        break;
      case "join":
        greet(msg.id, msg.name);
        break;
      case "leave":
        M.disconnectPlayer(state.match, msg.id);
        if (state.cup) {
          C.leave(state.cup, msg.id);
          scheduleCupSync();
        }
        break;
      case "msg": {
        const d = msg.d || {};
        if (d.t === "in") M.setInput(state.match, msg.from, d);
        else if (d.t === "face" && knows(msg.from)) receiveFace(msg.from, d);
        else if (d.t === "team") pickTeam(msg.from, d.team);
        else if (d.t === "cup-pick") cupPick(msg.from, d.team);
        else if (d.t === "cup-go" && state.cup && msg.from === C.vip(state.cup)) cupGo(d.phase);
        else if (d.t === "cheer") cheer(msg.from);
        return;
      }
      default:
        return;
    }
    renderRoster();
  }

  function receiveFace(id, chunk) {
    const done = state.faceAssembler.accept(id, chunk);
    if (!done) return;
    if (!done.face) {
      state.faces.delete(id);
      renderRoster();
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!knows(id)) return;
      state.faces.set(id, { url: done.face, img });
      renderRoster();
      if (state.cup) scheduleCupSync();
    };
    img.src = done.face;
  }

  // ---------- Match events ----------
  function handleEvents() {
    for (const ev of M.drainEvents(state.match)) {
      state.renderer.onEvent(ev, state.match);
      playSound(ev);
      if (ev.type === "goal") {
        if (state.cup && !ev.ownGoal) C.goal(state.cup, ev.scorerId);
        renderScore();
        broadcast({ t: "goal", team: ev.team, scorerId: ev.scorerId, scorerName: ev.scorerName, ownGoal: ev.ownGoal, points: ev.points, score: ev.score });
        const team = M.TEAMS[ev.team];
        const who = ev.scorerName ? (ev.ownGoal ? `Own goal by ${ev.scorerName}` : `${ev.scorerName} scores!`) : "";
        showGoalBanner(team, ev.points > 1 ? `🌸 ${who} — worth ${ev.points}!` : who, ev.points > 1 ? `${ev.points}× GOAL!` : "GOAL!");
      } else if (ev.type === "reset") {
        renderScore();
        broadcast({ t: "score", ...state.match.score });
      } else if (ev.type === "period") {
        // A championship tie is over: record it (the cup then shows the result and moves on).
        if (state.cup && ev.period === "full" && state.cup.phase === "match") C.finish(state.cup, ev.score.left, ev.score.right);
        onPeriod(ev);
      } else if (ev.type === "star-spawn") {
        showStarToast("⭐ A star appeared — grab it!");
      } else if (ev.type === "star-get") {
        showStarToast(`⭐ ${ev.name} is invincible!`);
        sendTo(ev.id, { t: "star", on: true, secs: M.STAR_POWER });
      } else if (ev.type === "star-end") {
        sendTo(ev.id, { t: "star", on: false });
      } else if (ev.type === "shroom-spawn") {
        showStarToast("🍄 A mushroom sprouted — eat it!");
      } else if (ev.type === "shroom-get") {
        showStarToast(`🍄 ${ev.name} got HUGE!`);
        sendTo(ev.id, { t: "big", on: true, secs: M.BIG_POWER });
      } else if (ev.type === "shroom-end") {
        sendTo(ev.id, { t: "big", on: false });
      } else if (ev.type === "flower-spawn") {
        showStarToast("🌸 A power flower bloomed — grab it!");
      } else if (ev.type === "flower-get") {
        showStarToast(`🌸 ${ev.name} has flower power — goals count ${M.FLOWER_POINTS}×!`);
        sendTo(ev.id, { t: "flower", on: true, secs: M.FLOWER_POWER, points: M.FLOWER_POINTS });
      } else if (ev.type === "flower-end") {
        sendTo(ev.id, { t: "flower", on: false });
      }
    }
  }

  // ---------- Sound ----------
  const panAt = (x) => (x - M.CX) / (M.W / 2);
  const seedOf = (id) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  function playSound(ev) {
    const m = state.match;
    if (ev.type === "dash") {
      const p = m.players.get(ev.id);
      S.whoosh(p ? panAt(p.x) * 0.7 : 0);
    } else if (ev.type === "bump") {
      for (const id of [ev.a, ev.b]) {
        const p = m.players.get(id);
        S.oof(id, p ? panAt(p.x) * 0.7 : 0, seedOf(id));
      }
    } else if (ev.type === "goal") S.crowd();
    else if (ev.type === "shroom-get") S.grow();
    else if (ev.type === "flower-get") S.fanfare();
    else if (ev.type === "star-get") S.starOn(M.STAR_POWER);
    else if (ev.type === "star-end") S.starOff();
    else if (ev.type === "period") {
      state.countSaid = null;
      // A half (or the whole game) just ran out of time.
      if (ev.period === "second" || ev.period === "golden" || ev.period === "full") S.airHorn();
    }
  }

  // Count the last 10 seconds of each half out loud.
  function soundClock() {
    const m = state.match;
    if (m.period !== "first" && m.period !== "second") return;
    const s = Math.ceil(m.clock);
    if (s >= 1 && s <= 10 && s !== state.countSaid) {
      state.countSaid = s;
      S.count(s);
    }
  }

  function renderSoundBtn() {
    const on = S.enabled;
    el.soundBtn.classList.toggle("is-locked", S.locked());
    el.soundBtn.setAttribute("aria-pressed", String(on));
    el.soundBtn.title = !on ? "Sound off (M)" : S.locked() ? "Click anywhere to turn on sound" : "Sound on (M)";
    el.soundOn.hidden = !on;
    el.soundOff.hidden = on;
  }

  function periodMessage() {
    const m = state.match;
    return { t: "period", period: m.period, clock: Math.ceil(m.clock), score: { ...m.score } };
  }

  const fmtClock = (s) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, "0")}`;

  function onPeriod(ev) {
    renderScore();
    // Ends can change (half-time swap, or back to normal for a new game): refresh every phone's sides before
    // announcing the period, so "you now attack ←" is right.
    if (ev.period !== "full") for (const p of realPlayers()) sendYou(p);
    broadcast(periodMessage());
    const { period, score } = ev;
    if (period === "first") {
      el.periodBanner.hidden = true;
      showStarToast("⚽ Kick off — 1st half!");
    } else if (period === "second") {
      el.periodBanner.hidden = true;
      showStarToast("🔄 2nd half — teams swapped ends!");
    } else if (period === "golden") {
      showPeriodBanner("NEXT GOAL WINS!", `⚡ All square at ${score.left}–${score.right} — no time limit now.`, "#fde047");
      setTimeout(() => {
        if (state.match.period === "golden") el.periodBanner.hidden = true;
      }, 3500);
    } else if (period === "full" && state.cup) {
      // The championship announces the winner itself (see showCupResult).
    } else if (period === "full") {
      const winner = score.left === score.right ? null : score.left > score.right ? "left" : "right";
      const show = () =>
        showPeriodBanner(
          "FULL TIME",
          winner ? `<span class="team-chip team-chip--${winner}"></span> wins ${Math.max(score.left, score.right)}–${Math.min(score.left, score.right)}!` : `It's a draw, ${score.left}–${score.right}`,
          winner ? M.TEAMS[winner].color : "#ffffff",
          true,
        );
      // After a golden goal, let the GOAL! celebration finish first.
      if (el.goalBanner.hidden) show();
      else {
        el.periodBanner.hidden = true;
        setTimeout(() => {
          if (state.match.period === "full") show();
        }, (M.GOAL_PAUSE - 0.2) * 1000);
      }
    } else {
      el.periodBanner.hidden = true;
    }
    renderClock(true);
  }

  // `subHtml` is only ever built from our own markup and numbers.
  function showPeriodBanner(word, sub, color, isHtml) {
    el.periodBanner.style.setProperty("--accent-color", color);
    el.periodWord.textContent = word;
    if (isHtml) el.periodSub.innerHTML = sub;
    else el.periodSub.textContent = sub;
    el.periodBanner.hidden = false;
    el.starToast.hidden = true;
    el.periodBanner.classList.remove("is-in");
    void el.periodBanner.offsetWidth;
    el.periodBanner.classList.add("is-in");
  }

  // Update the clock pill (and tell phones) once per displayed second.
  function renderClock(force) {
    const m = state.match;
    const cupTie = state.cup && (state.cup.phase === "next" || state.cup.phase === "match" || state.cup.phase === "result") ? C.onPitch(state.cup) : null;
    const timed = m.period !== "free" && (!state.cup || Boolean(cupTie));
    // Championship ties don't count down into a new game at full time.
    const untimed = m.period === "pre" || m.period === "golden" || (Boolean(state.cup) && m.period === "full");
    const label = `${cupTie ? `${cupTie.label} · ` : ""}${state.cup && m.period === "pre" ? "Warm-up" : PERIOD_LABEL[m.period]}`;
    const text = !timed ? "" : untimed ? label : `${label} · ${fmtClock(m.clock)}`;
    if (text === state.clockShown && !force) return;
    state.clockShown = text;
    el.matchClock.hidden = !timed;
    el.matchClock.textContent = text;
    el.matchClock.classList.toggle("is-low", (m.period === "first" || m.period === "second") && m.clock <= 30);
    el.matchClock.classList.toggle("is-golden", m.period === "golden");
    el.periodCount.textContent = m.period === "full" && !state.cup ? `Next game in ${fmtClock(m.clock)}` : "";
    if (timed && !force) broadcast({ t: "clock", period: m.period, clock: Math.ceil(m.clock) });
  }

  function setLength(minutes) {
    store(LENGTH_KEY, String(minutes));
    // In championship mode this is remembered for when normal play resumes.
    if (!state.cup) {
      M.setGameLength(state.match, minutes);
      el.goalBanner.hidden = true;
    }
    updateLengthPicker();
  }

  function savedLength() {
    const v = stored(LENGTH_KEY);
    return v === null ? DEFAULT_LENGTH : Number(v);
  }

  function updateLengthPicker() {
    const minutes = state.cup ? savedLength() : state.match.length / 60;
    el.lengthPicker.querySelectorAll(".theme-chip").forEach((c) => c.classList.toggle("is-active", Number(c.dataset.length) === minutes));
  }

  function showStarToast(text) {
    el.starToast.textContent = text;
    el.starToast.hidden = false;
    el.starToast.classList.remove("is-in");
    void el.starToast.offsetWidth;
    el.starToast.classList.add("is-in");
    clearTimeout(state.starTimer);
    state.starTimer = setTimeout(() => (el.starToast.hidden = true), 3000);
  }

  function setRule(key, on) {
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      // Not persisted; still applies for this session.
    }
    if (key === TEAM_PICK_KEY) {
      state.teamPick = on;
      for (const p of realPlayers()) sendYou(p);
    } else {
      M.setMayhem(state.match, on);
      if (!on) el.starToast.hidden = true;
    }
  }

  function loadRules() {
    const get = (key) => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    };
    state.teamPick = get(TEAM_PICK_KEY);
    M.setMayhem(state.match, get(MAYHEM_KEY));
  }

  function showGoalBanner(team, who, word) {
    el.goalBanner.style.setProperty("--team", team.color);
    el.goalWord.textContent = word;
    el.goalWho.textContent = who;
    el.goalBanner.hidden = false;
    el.goalBanner.classList.remove("is-in");
    void el.goalBanner.offsetWidth;
    el.goalBanner.classList.add("is-in");
    clearTimeout(state.bannerTimer);
    state.bannerTimer = setTimeout(() => (el.goalBanner.hidden = true), (M.GOAL_PAUSE - 0.2) * 1000);
  }

  // ---------- Championship ----------
  // While it's on, everyone's phone stays connected; only the two teams in the current tie are on the pitch.
  const cupLive = () => Boolean(state.cup) && (state.cup.phase === "next" || state.cup.phase === "match");
  const esc = (s) => util.escapeHtml(s);

  function loadCupSettings() {
    try {
      const s = JSON.parse(stored(CUP_SETTINGS_KEY) || "{}") || {};
      if (C.SIZES.includes(s.size)) state.cupSettings.size = s.size;
      if (M.CUP_LENGTHS.includes(s.length)) state.cupSettings.length = s.length;
      if (C.THEMES[s.theme]) state.cupSettings.theme = s.theme;
      if (typeof s.merge === "boolean") state.cupSettings.merge = s.merge;
    } catch {
      // Defaults.
    }
  }

  // Team count and names apply in the lobby (or from the next championship); match length from the next tie.
  function setCupSetting(key, value) {
    state.cupSettings[key] = value;
    store(CUP_SETTINGS_KEY, JSON.stringify(state.cupSettings));
    if (state.cup && key !== "length") C.configure(state.cup, { [key]: value });
    updateCupPickers();
    if (state.cup) syncCup();
  }

  function updateCupPickers() {
    const s = state.cupSettings;
    const mark = (picker, attr, value) => picker.querySelectorAll(".theme-chip").forEach((c) => c.classList.toggle("is-active", c.dataset[attr] === String(value)));
    // Show what's chosen; mid-championship the note explains it applies to the next one.
    mark(el.cupSizePicker, "size", s.size);
    mark(el.cupLengthPicker, "length", s.length);
    mark(el.cupThemePicker, "names", s.theme);
    el.cupMergeToggle.checked = s.merge;
    el.cupToggle.checked = Boolean(state.cup);
    el.cupSettings.hidden = !state.cup;
    el.cupLocked.hidden = !state.cup || state.cup.phase === "lobby";
  }

  function savedCup() {
    try {
      return JSON.parse(stored(CUP_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveCup() {
    if (state.cup) store(CUP_KEY, JSON.stringify(C.save(state.cup)));
  }

  // `fresh`: turned on from Settings, so a finished championship goes back to its lobby for another one.
  function setCupMode(on, fresh = true) {
    store(CUP_ON_KEY, on ? "1" : "0");
    if (Boolean(state.cup) === on) return;
    const m = state.match;
    if (on) {
      const here = realPlayers().filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name }));
      if (state.keyboard) toggleKeyboard();
      const cup = C.load(savedCup()) || C.createCup(state.cupSettings);
      for (const p of here) C.join(cup, p.id, p.name);
      if (fresh && cup.phase === "champion") C.restart(cup);
      C.configure(cup, state.cupSettings);
      C.drainEvents(cup);
      state.cup = cup;
      store(CUP_ROOM_KEY, state.room);
      Object.assign(m, { manual: true, maxPlayers: CUP_MAX_PLAYERS });
      setJoinOpen(false);
      onCupPhase();
    } else {
      saveCup();
      const here = [...state.cup.members.values()].filter((p) => p.connected);
      clearTimeout(state.cupSyncTimer);
      state.cupSyncTimer = null;
      state.cup = null;
      M.clearPlayers(m);
      Object.assign(m, { manual: false, maxPlayers: M.MAX_PLAYERS });
      M.setGameLength(m, savedLength());
      el.periodBanner.hidden = true;
      el.goalBanner.hidden = true;
      for (const p of here) greet(p.id, p.name);
      renderCup();
      renderRoster();
      renderScore();
      renderClock(true);
    }
    updateCupPickers();
    updateLengthPicker();
  }

  // Set up the pitch, overlays, sounds and phones for the phase the championship just entered.
  function onCupPhase() {
    const cup = state.cup;
    const m = state.match;
    state.countSaid = null;
    state.cupPhaseAt = performance.now();
    if (cup.phase === "lobby" || cup.phase === "draw") {
      M.clearPlayers(m);
      M.setGameLength(m, state.cupSettings.length);
      state.cupPitch = null;
      if (cup.phase === "draw") setJoinOpen(false);
    } else if (cup.phase === "next") {
      setupPitch();
      setJoinOpen(false);
    } else if (cup.phase === "match") {
      // Normally the warm-up already put this tie's teams out; if phases were skipped in a hurry, do it now.
      const t = C.current(cup);
      if (state.cupPitch !== `${t.r}:${t.i}`) setupPitch();
      M.startGame(m);
      S.whistle();
    } else if (cup.phase === "result") {
      showCupResult();
    } else if (cup.phase === "champion") {
      el.periodBanner.hidden = true;
      const info = C.teamInfo(cup, cup.champion);
      state.renderer.burst(M.CX, M.CY - 120, 220, [info.color, "#fde047", "#ffffff", "#38bdf8", "#fb923c"]);
      S.fanfare();
      S.crowd();
    }
    updateCupPickers();
    renderRoster();
    renderScore();
    renderClock(true);
    syncCup();
    focusCupButton();
  }

  function cupEvents() {
    if (state.cup && C.drainEvents(state.cup).some((e) => e.type === "phase")) onCupPhase();
  }

  // A TV remote's OK button presses whatever is focused, so focus the action that moves things along (not on the
  // trophy screen, where a stray press would cut the celebration short).
  function focusCupButton() {
    if (el.settings.open) return;
    const btn = { lobby: el.cupStart, draw: el.cupBoardGo, next: el.cupBoardGo }[state.cup ? state.cup.phase : ""];
    if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  }

  // A fresh pitch for the current tie: its two teams (whoever's connected) in their kickoff spots, warming up.
  function setupPitch() {
    const t = C.current(state.cup);
    M.clearPlayers(state.match);
    M.setGameLength(state.match, state.cupSettings.length);
    state.cupPitch = t ? `${t.r}:${t.i}` : null;
    fillPitch();
  }

  // Put the connected players of the current tie on the pitch (on joining, picking, or reconnecting too).
  function fillPitch() {
    if (!cupLive()) return;
    const t = C.onPitch(state.cup);
    for (const mem of state.cup.members.values()) {
      const side = mem.team === t.a ? "left" : mem.team === t.b ? "right" : null;
      if (!side || !mem.connected || state.match.players.has(mem.id)) continue;
      const p = M.addPlayer(state.match, mem.id, mem.name, side);
      if (p) sendYou(p);
    }
    renderRoster();
  }

  function cupGreet(id, name) {
    C.join(state.cup, id, name);
    const p = state.match.players.get(id);
    if (p) {
      M.addPlayer(state.match, id, name);
      sendYou(p);
    } else fillPitch();
    sendTo(id, cupMessage(id));
    scheduleCupSync();
  }

  function cupPick(id, team) {
    if (!state.cup) return;
    if (C.pick(state.cup, id, team)) {
      fillPitch();
      scheduleCupSync();
    } else sendTo(id, cupMessage(id));
  }

  // The commissioner's phone (or a button on the big screen) moves things along. A press only counts for the phase
  // it was made in, and not in the moment right after a change — so a double tap or a second OK on the remote
  // can't start the championship and skip the draw and warm-up in one go.
  function cupGo(phase) {
    const cup = state.cup;
    if (!cup || (phase && phase !== cup.phase) || performance.now() - state.cupPhaseAt < GO_GAP) return;
    if (cup.phase === "lobby") C.start(cup);
    else if (cup.phase === "champion") restartCup();
    else C.skip(cup);
    cupEvents();
  }

  function restartCup() {
    if (!state.cup) return;
    C.restart(state.cup);
    C.configure(state.cup, state.cupSettings);
    cupEvents();
  }

  // Spectators' cheers float up the big screen.
  function cheer(id) {
    const cup = state.cup;
    if (!cup || !cup.members.has(id) || state.match.players.has(id)) return;
    const now = performance.now() / 1000;
    if (now - (state.cheers.get(id) || -1) < CHEER_GAP) return;
    state.cheers.set(id, now);
    const info = C.teamInfo(cup, cup.members.get(id).team);
    const options = ["👏", "🎉", "📣", info ? info.emoji : "🙌"];
    state.renderer.onEvent({ type: "cheer", emoji: options[Math.floor(Math.random() * options.length)] }, state.match);
  }

  function cupShared() {
    const cup = state.cup;
    const people = [...cup.members.values()].filter((p) => p.connected).sort((a, b) => a.seq - b.seq);
    const tie = C.onPitch(cup) || C.current(cup);
    const vip = C.vip(cup);
    return {
      t: "cup", on: true, phase: cup.phase, size: cup.size, timer: Math.ceil(cup.timer), merge: cup.merge,
      teams: cup.teams.map((t) => {
        const info = C.teamInfo(cup, t.id);
        return { id: t.id, name: info.name, emoji: info.emoji, color: info.color, out: t.out, into: t.into, names: people.filter((p) => p.team === t.id).map((p) => p.name) };
      }),
      tie: tie ? { label: tie.label, a: tie.a, b: tie.b, w: tie.w, s: tie.s, wo: tie.wo } : null,
      bracket: cup.rounds.map((round, r) => round.map((t, i) => ({ label: C.label(cup, r, i), a: t.a, b: t.b, w: t.w, s: t.s }))),
      score: { ...state.match.score },
      champion: cup.champion,
      boot: C.topScorers(cup).map((s) => ({ name: s.name, goals: s.goals })),
      need: C.needed(cup),
      missing: C.missing(cup),
      players: people.length,
      vipName: vip ? cup.members.get(vip).name : null,
    };
  }

  // What one phone needs: the shared picture plus its own team, side on the pitch, and commissioner powers.
  function cupMessage(id, shared = cupShared()) {
    const cup = state.cup;
    const mem = cup.members.get(id);
    const p = state.match.players.get(id);
    return {
      ...shared, mine: mem ? mem.team : null, side: p ? p.team : null, vip: id === C.vip(cup), note: C.note(cup, id),
      moved: cup.phase === "draw" && cup.moves.some((mv) => mv.id === id && mv.from !== null),
    };
  }

  function syncCup() {
    clearTimeout(state.cupSyncTimer);
    state.cupSyncTimer = null;
    if (!state.cup) return;
    const shared = cupShared();
    for (const mem of state.cup.members.values()) if (mem.connected) sendTo(mem.id, cupMessage(mem.id, shared));
    saveCup();
    renderCup();
  }

  // Lobby picks can come thick and fast; batch them.
  function scheduleCupSync() {
    if (state.cup && !state.cupSyncTimer) state.cupSyncTimer = setTimeout(syncCup, 150);
  }

  // Once a frame: spoken countdown into each kickoff, and the countdown on the board.
  function cupTick() {
    const cup = state.cup;
    const secs = Math.ceil(cup.timer);
    const away = C.missing(cup);
    if (cup.phase === "next" && !away.length && secs >= 1 && secs <= 5 && secs !== state.countSaid) {
      state.countSaid = secs;
      S.count(secs);
    }
    let text = cup.phase === "draw" ? `First match in ${fmtClock(cup.timer)}` : cup.phase === "next" ? `Warm up! Kick off in ${fmtClock(cup.timer)}` : "";
    if (away.length) text = `Waiting for the ${away.map((t) => C.teamLabel(cup, t)).join(" and the ")} to rejoin…`;
    if (text !== state.cupShown) {
      state.cupShown = text;
      el.cupBoardCount.textContent = text;
      // Show the bracket for the first seconds of a warm-up, then get out of the way so players can find their block.
      el.cupBoard.classList.toggle("is-compact", cup.phase === "next" && cup.timer <= C.NEXT_SHOW - 10);
      // Kicking off without a team hands the other a walkover; say so on the button.
      el.cupBoardGo.textContent = cup.phase === "draw" ? "Skip ▶" : away.length ? "Kick off anyway (walkover) ▶" : "Kick off now ▶";
    }
  }

  // Full time in a tie: the winner's name, big.
  function showCupResult() {
    const cup = state.cup;
    const t = C.onPitch(cup);
    if (!t || t.w === null) return;
    const info = C.teamInfo(cup, t.w);
    const loser = t.w === t.a ? t.b : t.a;
    const score = t.wo ? `Walkover — the ${C.teamLabel(cup, loser)} had nobody here` : `${Math.max(...t.s)}–${Math.min(...t.s)}`;
    const onward = cup.champion !== null ? "🏆 CHAMPIONS!" : `through to the ${C.label(cup, t.r + 1, Math.floor(t.i / 2)).replace(/ \d+$/, "")}`;
    const show = () => showPeriodBanner(`${info.emoji} ${info.name.toUpperCase()} WIN!`, `${score} · ${onward}`, info.color);
    // After a golden goal, let the GOAL! celebration finish first.
    if (el.goalBanner.hidden) show();
    else {
      el.periodBanner.hidden = true;
      setTimeout(() => {
        if (state.cup && state.cup.phase === "result") show();
      }, (M.GOAL_PAUSE - 0.2) * 1000);
    }
  }

  // ---------- Championship: big-screen overlays ----------
  function renderCup() {
    const cup = state.cup;
    const phase = cup ? cup.phase : "";
    document.body.dataset.cup = phase;
    el.cupLobby.hidden = phase !== "lobby";
    el.cupBoard.hidden = phase !== "draw" && phase !== "next";
    el.cupChampion.hidden = phase !== "champion";
    const t = phase === "next" || phase === "match" || phase === "result" ? C.onPitch(cup) : null;
    el.cupNameLeft.hidden = !t;
    el.cupNameRight.hidden = !t;
    if (t) {
      const a = C.teamInfo(cup, t.a);
      const b = C.teamInfo(cup, t.b);
      el.cupNameLeft.textContent = `${a.emoji} ${a.name}`;
      el.cupNameRight.textContent = `${b.name} ${b.emoji}`;
    }
    if (phase === "lobby") renderCupLobby();
    else if (phase === "draw" || phase === "next") renderCupBoard();
    else if (phase === "champion") renderCupChampion();
  }

  const memberChip = (p) => `<li class="chip${p.connected ? "" : " is-away"}">${faceThumb(p.id)}${esc(p.name)}</li>`;

  function renderCupLobby() {
    const cup = state.cup;
    const url = joinUrl();
    if (el.cupQr.dataset.url !== url) {
      el.cupQr.innerHTML = U.qr.toSvg(url);
      el.cupQr.dataset.url = url;
    }
    el.cupRoom.textContent = state.room;
    el.cupUrl.textContent = shortPlayUrl();
    const people = [...cup.members.values()].filter((p) => p.connected).sort((a, b) => a.seq - b.seq);
    el.cupTeams.dataset.size = cup.size;
    el.cupTeams.innerHTML = cup.teams
      .map((t) => {
        const info = C.teamInfo(cup, t.id);
        const members = people.filter((p) => p.team === t.id);
        return `<div class="cup-team" style="--team: ${info.color}"><div class="cup-team__head"><span class="cup-team__emoji">${info.emoji}</span><span class="cup-team__name">${info.name}</span><span class="cup-team__count">${members.length}</span></div><ul class="cup-team__members">${members.map(memberChip).join("") || '<li class="cup-team__empty">Nobody yet</li>'}</ul></div>`;
      })
      .join("");
    const undecided = people.filter((p) => p.team === null);
    el.cupWaiting.textContent = undecided.length ? `Still picking: ${undecided.map((p) => p.name).join(", ")}` : people.length ? "" : "Waiting for the first player…";
    const vip = C.vip(cup);
    const need = C.needed(cup);
    el.cupVip.textContent = vip ? `👑 ${cup.members.get(vip).name} can start it from their phone.` : "The first phone to join can start it from their phone.";
    const wasDisabled = el.cupStart.disabled;
    el.cupStart.disabled = need > 0;
    el.cupStart.textContent = need > 0 ? `Need ${need} more player${need === 1 ? "" : "s"} to start` : `▶ Start the championship · ${people.length} players`;
    if (wasDisabled && !el.cupStart.disabled) focusCupButton();
  }

  function vsHtml(cup, t) {
    const a = C.teamInfo(cup, t.a);
    const b = C.teamInfo(cup, t.b);
    return `<span class="cup-vs__team"><span class="team-chip team-chip--left"></span>${a.emoji} ${a.name}</span><span class="cup-vs__v">vs</span><span class="cup-vs__team">${b.name} ${b.emoji}<span class="team-chip team-chip--right"></span></span>`;
  }

  function bracketHtml(cup) {
    const now = cup.phase === "next" || cup.phase === "match" ? C.current(cup) : null;
    return cup.rounds
      .map((round, r) => {
        const name = C.label(cup, r, 0).replace(/ \d+$/, "") + (round.length > 1 ? "s" : "");
        const ties = round
          .map((t, i) => {
            const row = (team, score) => {
              const cls = t.w === null ? "" : t.w === team ? " is-win" : " is-out";
              return `<div class="cup-tie__team${cls}"><span>${team === null ? "?" : esc(C.teamLabel(cup, team))}</span>${score === null ? "" : `<b>${score}</b>`}</div>`;
            };
            const isNow = now && now.r === r && now.i === i;
            return `<div class="cup-tie${isNow ? " is-now" : ""}">${row(t.a, t.s && !t.wo ? t.s[0] : null)}${row(t.b, t.s && !t.wo ? t.s[1] : null)}${t.wo ? "<small>walkover</small>" : ""}</div>`;
          })
          .join("");
        return `<div class="cup-round"><div class="cup-round__name">${name}</div><div class="cup-round__ties">${ties}</div></div>`;
      })
      .join("");
  }

  function renderCupBoard() {
    const cup = state.cup;
    const draw = cup.phase === "draw";
    const t = C.current(cup);
    el.cupBoardLabel.textContent = draw ? "The draw" : t ? t.label : "";
    el.cupBoardVs.innerHTML = t && !draw ? vsHtml(cup, t) : "";
    el.cupBoardVs.hidden = draw;
    const moves = cup.moves.filter((mv) => mv.from !== null);
    el.cupBoardMoves.hidden = !draw || !moves.length;
    el.cupBoardMoves.textContent = moves.length ? `Evening up the teams: ${moves.map((mv) => `${mv.name} → ${C.teamLabel(cup, mv.to)}`).join(" · ")}` : "";
    el.cupBoardGo.textContent = draw ? "Skip ▶" : C.missing(cup).length ? "Kick off anyway (walkover) ▶" : "Kick off now ▶";
    el.cupBracket.innerHTML = bracketHtml(cup);
    // While the next teams warm up, keep the bracket small so the pitch stays in view.
    el.cupBracket.classList.toggle("cup-bracket--small", !draw);
  }

  function renderCupChampion() {
    const cup = state.cup;
    const info = C.teamInfo(cup, cup.champion);
    el.cupChampion.style.setProperty("--team", info.color);
    el.cupChampTeam.textContent = `${info.emoji} ${info.name}`;
    const merged = cup.teams.filter((t) => t.into !== null && t.id !== cup.champion).length;
    const winners = [...cup.members.values()].filter((p) => p.team === cup.champion).sort((a, b) => a.seq - b.seq);
    el.cupChampNames.innerHTML = winners.map(memberChip).join("");
    el.cupChampNames.dataset.merged = merged;
    const boot = C.topScorers(cup);
    el.cupChampBoot.hidden = !boot.length;
    const names = boot.length > 3 ? `${boot.slice(0, 2).map((b) => b.name).join(", ")} & ${boot.length - 2} more` : boot.map((b) => b.name).join(" & ");
    el.cupChampBoot.textContent = boot.length ? `⚽ Golden Boot: ${names} · ${boot[0].goals} goal${boot[0].goals === 1 ? "" : "s"}` : "";
    el.cupChampBracket.innerHTML = bracketHtml(cup);
  }

  // ---------- Keyboard player (try it without a phone) ----------
  function toggleKeyboard() {
    if (!state.keyboard && state.cup) {
      showStarToast("⌨️ Keyboard play is off in championship mode");
      return;
    }
    state.keyboard = !state.keyboard;
    if (state.keyboard) {
      greet(KEYBOARD_ID, "Keyboard");
      M.setInput(state.match, KEYBOARD_ID, { x: 0, y: 0, k: state.keyboardKicks });
    } else {
      state.match.players.delete(KEYBOARD_ID);
    }
    el.kbBtn.classList.toggle("is-active", state.keyboard);
    el.kbBtn.setAttribute("aria-pressed", String(state.keyboard));
    renderRoster();
  }

  function keyboardInput() {
    const k = state.keys;
    const x = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
    const y = (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0);
    M.setInput(state.match, KEYBOARD_ID, { x, y, k: state.keyboardKicks });
  }

  // ---------- UI ----------
  function realPlayers() {
    return [...state.match.players.values()].filter((p) => p.id !== KEYBOARD_ID);
  }

  function renderJoinCard() {
    const url = joinUrl();
    el.qr.innerHTML = U.qr.toSvg(url);
    el.miniQr.innerHTML = U.qr.toSvg(url);
    el.roomCode.textContent = state.room;
    el.miniRoom.textContent = state.room;
    el.joinUrl.textContent = shortPlayUrl();
    el.joinLink.href = url;
  }

  function setJoinOpen(open) {
    state.joinOpen = open;
    el.joinCard.hidden = !open;
    el.joinMini.hidden = open;
  }

  function renderScore() {
    el.scoreLeft.textContent = state.match.score.left;
    el.scoreRight.textContent = state.match.score.right;
  }

  function faceThumb(id) {
    const f = state.faces.get(id);
    return f && F.isFaceDataUrl(f.url) ? `<img class="chip__face" src="${f.url}" alt="" />` : "";
  }

  function renderRoster() {
    for (const id of state.faces.keys()) if (!knows(id)) state.faces.delete(id);
    const players = [...state.match.players.values()].sort((a, b) => a.number - b.number);
    for (const team of ["left", "right"]) {
      const list = players.filter((p) => p.team === team);
      el[`roster_${team}`].innerHTML = list
        .map(
          (p) =>
            `<li class="chip${p.connected ? "" : " is-away"}"><span class="chip__num">${p.number}</span>${faceThumb(p.id)}${util.escapeHtml(p.name)}${p.connected ? "" : " <em>away</em>"}</li>`,
        )
        .join("");
      el[`roster_${team}`].hidden = list.length === 0;
    }
    el.emptyHint.hidden = players.length > 0;
  }

  const STATUS_TEXT = {
    connecting: "Connecting…",
    open: "Live",
    reconnecting: "Reconnecting…",
    error: "Relay error",
    closed: "Offline",
    replaced: "Open elsewhere",
  };

  function renderStatus(status, detail) {
    el.status.dataset.state = status;
    el.statusText.textContent = STATUS_TEXT[status] || status;
    if (status === "replaced") {
      showBanner("This room was opened on another screen.", "Take it back", () => {
        hideBanner();
        state.link.connect();
      });
    } else if (status === "open") {
      hideBanner();
    } else if (status === "reconnecting" && state.link && state.link.attempt > 3) {
      showBanner(`Can't reach the relay at ${state.relay}. Retrying…`, "Settings", openSettings);
    }
    if (detail && status === "error") console.warn("Relay:", detail);
  }

  function showBanner(text, actionLabel, action) {
    el.bannerText.textContent = text;
    el.bannerBtn.hidden = !actionLabel;
    el.bannerBtn.textContent = actionLabel || "";
    el.bannerBtn.onclick = action || null;
    el.banner.hidden = false;
  }

  function hideBanner() {
    el.banner.hidden = true;
  }

  function updateThemePicker() {
    const pref = util.getThemePref();
    el.themePicker.querySelectorAll(".theme-chip").forEach((c) => c.classList.toggle("is-active", c.dataset.themeVal === pref));
  }

  function openSettings() {
    updateThemePicker();
    updateLengthPicker();
    updateCupPickers();
    el.teamPickToggle.checked = state.teamPick;
    el.mayhemToggle.checked = state.match.mayhem;
    // In a championship, "New game" replays the tie being played (from its warm-up).
    el.resetBtn.textContent = state.cup ? "Replay this match" : "New game";
    el.resetBtn.disabled = Boolean(state.cup) && state.cup.phase !== "match";
    el.relayInput.value = state.relay;
    el.relayError.hidden = true;
    el.settings.showModal();
  }

  function saveRelay() {
    const value = el.relayInput.value.trim() || util.DEFAULT_RELAY;
    try {
      util.setRelayUrl(value);
    } catch (err) {
      el.relayError.textContent = err.message;
      el.relayError.hidden = false;
      return;
    }
    state.relay = util.relayUrl("");
    el.relayError.hidden = true;
    startRoom(state.room);
  }

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible" && !state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => (state.wakeLock = null));
      }
    } catch {
      // Not allowed yet (no user gesture); harmless.
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  // Schedule the next frame first, so one bad frame can never freeze the big screen.
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      tick(now);
    } catch (err) {
      if (!state.frameError) console.error(err);
      state.frameError = true;
    }
  }

  // TV browsers can be slow. If most frames are slow, try drawing at 1× instead of the screen's full pixel density;
  // keep it only if frames actually got faster (a browser capped at 30 fps — Energy Saver, Low Power Mode — won't).
  function watchFrameRate(dt) {
    if (state.dprSettled || (window.devicePixelRatio || 1) <= 1) return;
    state.slowFrames = state.slowFrames * 0.97 + (dt > 1 / 40 ? 0.03 : 0);
    state.avgFrame = state.avgFrame * 0.97 + dt * 0.03;
    const trial = state.dprTrial;
    if (!trial) {
      if (state.slowFrames > 0.6) {
        state.dprTrial = { frames: 0, before: state.avgFrame, dpr: state.renderer.maxDpr };
        state.renderer.setMaxDpr(1);
      }
      return;
    }
    if (++trial.frames < 150) return;
    const faster = state.avgFrame < trial.before * 0.8;
    if (!faster) state.renderer.setMaxDpr(trial.dpr);
    state.dprSettled = true;
    console.info(`Sky Soccer: ${faster ? "drawing at 1× pixel density for speed" : "frame rate is capped, keeping full sharpness"}.`);
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    watchFrameRate(dt);
    if (state.keyboard) keyboardInput();
    const before = state.match.players.size;
    // Fixed physics steps keep collisions consistent regardless of frame rate.
    let remaining = dt;
    while (remaining > 1e-4) {
      const h = Math.min(1 / 120, remaining);
      M.step(state.match, h);
      remaining -= h;
    }
    handleEvents();
    if (state.cup) {
      C.step(state.cup, dt);
      cupEvents();
      cupTick();
    }
    soundClock();
    renderClock();
    if (state.match.players.size !== before) renderRoster();
    state.renderer.render(state.match, dt);
  }

  function bind() {
    [
      "pitch", "status", "statusText", "kbBtn", "fsBtn", "settingsBtn", "joinCard", "joinMini", "joinClose", "qr", "miniQr",
      "roomCode", "miniRoom", "joinUrl", "joinLink", "emptyHint", "banner", "bannerText", "bannerBtn", "settings",
      "soundBtn", "soundOn", "soundOff", "themePicker", "relayInput", "relaySave", "relayReset", "relayError", "newRoomBtn", "resetBtn", "version", "appVersion", "settingsClose",
      "scoreLeft", "scoreRight", "goalBanner", "goalWho", "teamPickToggle", "mayhemToggle", "starToast", "goalWord", "matchClock", "periodBanner",
      "periodWord", "periodSub", "periodCount", "lengthPicker",
      "cupToggle", "cupSettings", "cupLocked", "cupSizePicker", "cupLengthPicker", "cupThemePicker", "cupMergeToggle", "cupRestartBtn",
      "cupNameLeft", "cupNameRight", "cupLobby", "cupQr", "cupRoom", "cupUrl", "cupTeams", "cupWaiting", "cupVip", "cupStart",
      "cupBoard", "cupBoardLabel", "cupBoardVs", "cupBoardMoves", "cupBoardCount", "cupBoardGo", "cupBracket",
      "cupChampion", "cupChampTeam", "cupChampNames", "cupChampBoot", "cupChampBracket", "cupAgain", "cupExit",
    ].forEach((id) => (el[id] = $(id)));
    el.roster_left = $("rosterLeft");
    el.roster_right = $("rosterRight");

    el.version.textContent = util.APP_VERSION;
    el.appVersion.textContent = `v${util.APP_VERSION}`;
    el.kbBtn.addEventListener("click", toggleKeyboard);
    el.fsBtn.addEventListener("click", () => {
      const root = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        const res = req && req.call(root);
        if (res && res.catch) res.catch(() => {});
      }
    });
    // A click that just unlocked audio shouldn't also mute it.
    el.soundBtn.addEventListener("click", () => {
      if (!state.soundWasLocked) S.setEnabled(!S.enabled);
    });
    S.onChange(renderSoundBtn);
    el.settingsBtn.addEventListener("click", openSettings);
    el.settingsClose.addEventListener("click", () => el.settings.close());
    el.joinClose.addEventListener("click", () => setJoinOpen(false));
    el.joinMini.addEventListener("click", () => setJoinOpen(true));
    el.themePicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest(".theme-chip");
      if (!chip) return;
      state.renderer.setTheme(util.setThemePref(chip.dataset.themeVal));
      updateThemePicker();
    });
    el.teamPickToggle.addEventListener("change", () => setRule(TEAM_PICK_KEY, el.teamPickToggle.checked));
    el.mayhemToggle.addEventListener("change", () => setRule(MAYHEM_KEY, el.mayhemToggle.checked));
    el.relaySave.addEventListener("click", saveRelay);
    el.relayReset.addEventListener("click", () => {
      el.relayInput.value = util.DEFAULT_RELAY;
      saveRelay();
    });
    el.newRoomBtn.addEventListener("click", () => {
      startRoom(null);
      setJoinOpen(true);
      el.settings.close();
    });
    el.resetBtn.addEventListener("click", () => {
      if (state.cup) {
        if (C.replay(state.cup)) cupEvents();
      } else M.resetMatch(state.match);
      el.goalBanner.hidden = true;
      el.settings.close();
    });
    el.lengthPicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-length]");
      if (chip) setLength(Number(chip.dataset.length));
    });

    el.cupToggle.addEventListener("change", () => setCupMode(el.cupToggle.checked));
    el.cupSizePicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-size]");
      if (chip) setCupSetting("size", Number(chip.dataset.size));
    });
    el.cupLengthPicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-length]");
      if (chip) setCupSetting("length", Number(chip.dataset.length));
    });
    el.cupThemePicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-names]");
      if (chip) setCupSetting("theme", chip.dataset.names);
    });
    el.cupMergeToggle.addEventListener("change", () => setCupSetting("merge", el.cupMergeToggle.checked));
    el.cupRestartBtn.addEventListener("click", () => {
      restartCup();
      el.settings.close();
    });
    el.cupStart.addEventListener("click", () => cupGo());
    el.cupBoardGo.addEventListener("click", () => cupGo());
    el.cupAgain.addEventListener("click", restartCup);
    el.cupExit.addEventListener("click", () => setCupMode(false));

    const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space"]);
    window.addEventListener("keydown", (ev) => {
      if (ev.target.closest && ev.target.closest("input, textarea, dialog")) return;
      if (ev.code === "KeyK" && !ev.metaKey && !ev.ctrlKey) toggleKeyboard();
      if (ev.code === "KeyM" && !ev.metaKey && !ev.ctrlKey && !state.soundWasLocked) S.setEnabled(!S.enabled);
      if (state.keyboard && GAME_KEYS.has(ev.code)) {
        if (ev.code === "Space" && !ev.repeat) state.keyboardKicks++;
        state.keys.add(ev.code);
        ev.preventDefault();
      }
    });
    window.addEventListener("keyup", (ev) => state.keys.delete(ev.code));
    window.addEventListener("blur", () => state.keys.clear());
    window.addEventListener("resize", () => state.renderer.resize());
    document.addEventListener("visibilitychange", keepAwake);
    document.addEventListener("pointerdown", keepAwake, { once: true });
    // Browsers only start audio after a click or key press on the page.
    for (const type of ["pointerdown", "keydown"]) {
      document.addEventListener(type, () => {
        state.soundWasLocked = S.locked();
        S.unlock();
      }, true);
    }
  }

  function init() {
    bind();
    state.renderer = new U.Renderer(el.pitch);
    state.renderer.faces = state.faces;
    loadRules();
    loadCupSettings();
    M.setGameLength(state.match, savedLength());
    state.renderer.setTheme(util.applyTheme());
    startRoom(new URLSearchParams(location.search).get("room") || sessionStorage.getItem(ROOM_KEY) || (stored(CUP_ON_KEY) === "1" ? stored(CUP_ROOM_KEY) : null));
    setJoinOpen(true);
    // A reload mid-championship picks it back up; phones reconnect on their own.
    if (stored(CUP_ON_KEY) === "1") setCupMode(true, false);
    updateCupPickers();
    renderScore();
    renderSoundBtn();
    keepAwake();
    requestAnimationFrame(frame);
    U.host = state;
  }

  init();
})();
