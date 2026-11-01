/* Uncinus — host (the Mac screen). Owns the match, renders it, and talks to phones through the relay. */
(function () {
  "use strict";

  const U = window.Uncinus;
  const { util, match: M } = U;
  const ROOM_KEY = "uncinus_room";
  const KEYBOARD_ID = "keyboard";

  const el = {};
  const state = {
    room: null,
    relay: util.relayUrl(),
    link: null,
    match: M.createMatch(),
    renderer: null,
    joinOpen: true,
    keyboard: false,
    keyboardKicks: 0,
    keys: new Set(),
    wakeLock: null,
    bannerTimer: null,
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
    const team = M.TEAMS[p.team];
    sendTo(id, { t: "you", name: p.name, team: p.team, teamName: team.name, color: team.color, number: p.number });
    sendTo(id, { t: "score", ...state.match.score });
    if (id !== KEYBOARD_ID && state.joinOpen && realPlayers().length === 1) setJoinOpen(false);
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
        return;
      default:
        return;
    }
    renderRoster();
  }

  // ---------- Match events ----------
  function handleEvents() {
    for (const ev of M.drainEvents(state.match)) {
      state.renderer.onEvent(ev, state.match);
      if (ev.type === "goal") {
        renderScore();
        broadcast({ t: "goal", team: ev.team, scorerId: ev.scorerId, scorerName: ev.scorerName, ownGoal: ev.ownGoal, score: ev.score });
        const team = M.TEAMS[ev.team];
        const who = ev.scorerName ? (ev.ownGoal ? `Own goal by ${ev.scorerName}` : `${ev.scorerName} scores for ${team.name}`) : `${team.name} scores`;
        showGoalBanner(team, who);
      } else if (ev.type === "reset") {
        renderScore();
        broadcast({ t: "score", ...state.match.score });
      }
    }
  }

  function showGoalBanner(team, who) {
    el.goalBanner.style.setProperty("--team", team.color);
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

  function renderRoster() {
    const players = [...state.match.players.values()].sort((a, b) => a.number - b.number);
    for (const team of ["left", "right"]) {
      const list = players.filter((p) => p.team === team);
      el[`roster_${team}`].innerHTML = list
        .map(
          (p) =>
            `<li class="chip${p.connected ? "" : " is-away"}"><span class="chip__num">${p.number}</span>${util.escapeHtml(p.name)}${p.connected ? "" : " <em>away</em>"}</li>`,
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
    if (state.match.players.size !== before) renderRoster();
    state.renderer.render(state.match, dt);
    requestAnimationFrame(frame);
  }

  function bind() {
    [
      "pitch", "status", "statusText", "kbBtn", "fsBtn", "settingsBtn", "joinCard", "joinMini", "joinClose", "qr", "miniQr",
      "roomCode", "miniRoom", "joinUrl", "joinLink", "emptyHint", "banner", "bannerText", "bannerBtn", "settings",
      "themePicker", "relayInput", "relaySave", "relayReset", "relayError", "newRoomBtn", "resetBtn", "version", "settingsClose",
      "scoreLeft", "scoreRight", "goalBanner", "goalWho",
    ].forEach((id) => (el[id] = $(id)));
    el.roster_left = $("rosterLeft");
    el.roster_right = $("rosterRight");

    el.version.textContent = util.APP_VERSION;
    el.kbBtn.addEventListener("click", toggleKeyboard);
    el.fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
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

    const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space"]);
    window.addEventListener("keydown", (ev) => {
      if (ev.target.closest && ev.target.closest("input, textarea, dialog")) return;
      if (ev.code === "KeyK" && !ev.metaKey && !ev.ctrlKey) toggleKeyboard();
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
  }

  function init() {
    bind();
    state.renderer = new U.Renderer(el.pitch);
    state.renderer.setTheme(util.applyTheme());
    startRoom(new URLSearchParams(location.search).get("room") || sessionStorage.getItem(ROOM_KEY));
    setJoinOpen(true);
    renderScore();
    keepAwake();
    requestAnimationFrame(frame);
    U.host = state;
  }

  init();
})();
