/* Uncinus — host (the Mac screen). Owns the match, renders it, and talks to phones through the relay. */
(function () {
  "use strict";

  const U = window.Uncinus;
  const { util, match: M, face: F, sound: S } = U;
  const ROOM_KEY = "uncinus_room";
  const KEYBOARD_ID = "keyboard";
  const TEAM_PICK_KEY = "uncinus_team_pick";
  const MAYHEM_KEY = "uncinus_mayhem";
  const LENGTH_KEY = "uncinus_length";
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
  };

  const $ = (id) => document.getElementById(id);

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
    for (const p of [...state.match.players.values()]) if (p.id !== KEYBOARD_ID) state.match.players.delete(p.id);
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
  }

  function sendTo(id, d) {
    if (id === KEYBOARD_ID || !state.link) return;
    state.link.send({ to: id, d });
  }

  function broadcast(d) {
    state.link && state.link.send({ to: "*", d });
  }

  function greet(id, name) {
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
      pick: state.teamPick, counts: teamCounts(),
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
    if (!state.teamPick) return;
    const p = M.setTeam(state.match, id, team);
    if (!p) return;
    sendYou(p);
    renderRoster();
  }

  function handleMessage(msg) {
    switch (msg.t) {
      case "welcome":
        for (const p of state.match.players.values()) if (p.id !== KEYBOARD_ID) M.disconnectPlayer(state.match, p.id);
        for (const p of msg.players || []) greet(p.id, p.name);
        break;
      case "join":
        greet(msg.id, msg.name);
        break;
      case "leave":
        M.disconnectPlayer(state.match, msg.id);
        break;
      case "msg":
        if (msg.d && msg.d.t === "in") M.setInput(state.match, msg.from, msg.d);
        else if (msg.d && msg.d.t === "face" && state.match.players.has(msg.from)) receiveFace(msg.from, msg.d);
        else if (msg.d && msg.d.t === "team") pickTeam(msg.from, msg.d.team);
        return;
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
      if (!state.match.players.has(id)) return;
      state.faces.set(id, { url: done.face, img });
      renderRoster();
    };
    img.src = done.face;
  }

  // ---------- Match events ----------
  function handleEvents() {
    for (const ev of M.drainEvents(state.match)) {
      state.renderer.onEvent(ev, state.match);
      playSound(ev);
      if (ev.type === "goal") {
        renderScore();
        broadcast({ t: "goal", team: ev.team, scorerId: ev.scorerId, scorerName: ev.scorerName, ownGoal: ev.ownGoal, points: ev.points, score: ev.score });
        const team = M.TEAMS[ev.team];
        const who = ev.scorerName ? (ev.ownGoal ? `Own goal by ${ev.scorerName}` : `${ev.scorerName} scores!`) : "";
        showGoalBanner(team, ev.points > 1 ? `🌸 ${who} — worth ${ev.points}!` : who, ev.points > 1 ? `${ev.points}× GOAL!` : "GOAL!");
      } else if (ev.type === "reset") {
        renderScore();
        broadcast({ t: "score", ...state.match.score });
      } else if (ev.type === "period") {
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
    const timed = m.period !== "free";
    const untimed = m.period === "pre" || m.period === "golden";
    const text = !timed ? "" : untimed ? PERIOD_LABEL[m.period] : `${PERIOD_LABEL[m.period]} · ${fmtClock(m.clock)}`;
    if (text === state.clockShown && !force) return;
    state.clockShown = text;
    el.matchClock.hidden = !timed;
    el.matchClock.textContent = text;
    el.matchClock.classList.toggle("is-low", (m.period === "first" || m.period === "second") && m.clock <= 30);
    el.matchClock.classList.toggle("is-golden", m.period === "golden");
    el.periodCount.textContent = m.period === "full" ? `Next game in ${fmtClock(m.clock)}` : "";
    if (timed && !force) broadcast({ t: "clock", period: m.period, clock: Math.ceil(m.clock) });
  }

  function setLength(minutes) {
    try {
      localStorage.setItem(LENGTH_KEY, String(minutes));
    } catch {
      // Not persisted; still applies for this session.
    }
    M.setGameLength(state.match, minutes);
    el.goalBanner.hidden = true;
    updateLengthPicker();
  }

  function savedLength() {
    try {
      const v = localStorage.getItem(LENGTH_KEY);
      return v === null ? DEFAULT_LENGTH : Number(v);
    } catch {
      return DEFAULT_LENGTH;
    }
  }

  function updateLengthPicker() {
    const minutes = state.match.length / 60;
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

  // ---------- Keyboard player (try it without a phone) ----------
  function toggleKeyboard() {
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
    for (const id of state.faces.keys()) if (!state.match.players.has(id)) state.faces.delete(id);
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
    el.teamPickToggle.checked = state.teamPick;
    el.mayhemToggle.checked = state.match.mayhem;
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
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
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
    soundClock();
    renderClock();
    if (state.match.players.size !== before) renderRoster();
    state.renderer.render(state.match, dt);
    requestAnimationFrame(frame);
  }

  function bind() {
    [
      "pitch", "status", "statusText", "kbBtn", "fsBtn", "settingsBtn", "joinCard", "joinMini", "joinClose", "qr", "miniQr",
      "roomCode", "miniRoom", "joinUrl", "joinLink", "emptyHint", "banner", "bannerText", "bannerBtn", "settings",
      "soundBtn", "soundOn", "soundOff", "themePicker", "relayInput", "relaySave", "relayReset", "relayError", "newRoomBtn", "resetBtn", "version", "appVersion", "settingsClose",
      "scoreLeft", "scoreRight", "goalBanner", "goalWho", "teamPickToggle", "mayhemToggle", "starToast", "goalWord", "matchClock", "periodBanner",
      "periodWord", "periodSub", "periodCount", "lengthPicker",
    ].forEach((id) => (el[id] = $(id)));
    el.roster_left = $("rosterLeft");
    el.roster_right = $("rosterRight");

    el.version.textContent = util.APP_VERSION;
    el.appVersion.textContent = `v${util.APP_VERSION}`;
    el.kbBtn.addEventListener("click", toggleKeyboard);
    el.fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
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
      M.resetMatch(state.match);
      el.goalBanner.hidden = true;
      el.settings.close();
    });
    el.lengthPicker.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-length]");
      if (chip) setLength(Number(chip.dataset.length));
    });

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
    M.setGameLength(state.match, savedLength());
    state.renderer.setTheme(util.applyTheme());
    startRoom(new URLSearchParams(location.search).get("room") || sessionStorage.getItem(ROOM_KEY));
    setJoinOpen(true);
    renderScore();
    renderSoundBtn();
    keepAwake();
    requestAnimationFrame(frame);
    U.host = state;
  }

  init();
})();
