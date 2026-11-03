/* Uncinus — phone controller. Turns touch or tilt into a run vector plus kick presses for the host. */
(function () {
  "use strict";

  const V = window.Uncinus;
  const { util, face: F } = V;
  const NAME_KEY = "uncinus_name";
  const FACE_KEY = "uncinus_face";
  const ID_KEY = "uncinus_player_id";
  const SEND_EVERY_MS = 50;
  const TILT_RANGE_DEG = 22;
  const STICK_RADIUS = 70;
  const KICK_COOLDOWN_MS = 900;

  const el = {};
  const state = {
    relay: util.relayUrl(),
    room: "",
    name: "",
    id: "",
    link: null,
    kicks: 0,
    kickReadyAt: 0,
    team: null,
    goalTimer: null,
    lastSent: "",
    drag: null,
    tilt: { on: false, x: 0, y: 0, neutral: null },
    wakeLock: null,
    sendTimer: null,
    face: null,
    faceSeq: 0,
    cam: null,
  };

  const $ = (id) => document.getElementById(id);
  const clamp = (v) => Math.max(-1, Math.min(1, v));

  function playerId() {
    let id = localStorage.getItem(ID_KEY);
    if (!/^[a-z0-9]{6,16}$/.test(id || "")) {
      id = util.randomId(12);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  }

  // ---------- Joining ----------
  function showJoin(error) {
    stopLink();
    el.teamPick.hidden = true;
    el.attackBar.hidden = true;
    document.body.classList.remove("is-star", "is-big", "is-flower");
    el.playScreen.hidden = true;
    el.joinScreen.hidden = false;
    el.joinError.hidden = !error;
    el.joinError.textContent = error || "";
  }

  function join(room, name) {
    state.room = room;
    state.name = name;
    state.id = playerId();
    localStorage.setItem(NAME_KEY, name);
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);

    el.joinScreen.hidden = true;
    el.playScreen.hidden = false;
    el.meName.textContent = name;
    el.meRoom.textContent = room;
    el.meColor.textContent = "Joining";
    el.meSwatch.style.backgroundColor = "";
    renderFace();
    el.meNumber.textContent = "";

    stopLink();
    const params = new URLSearchParams({ role: "player", id: state.id, name });
    state.link = new V.Link({ url: `${state.relay}/room/${room}?${params}`, onMessage: handleMessage, onStatus: handleStatus });
    state.link.connect();
    state.sendTimer = setInterval(flush, SEND_EVERY_MS);
    keepAwake();
  }

  function stopLink() {
    clearInterval(state.sendTimer);
    if (state.link) state.link.close();
    state.link = null;
  }

  function handleMessage(msg) {
    switch (msg.t) {
      case "welcome":
        state.lastSent = "";
        hideOverlay();
        break;
      case "you":
        sendFace();
        state.team = msg.team;
        el.meSwatch.style.backgroundColor = msg.color;
        el.meNumber.textContent = msg.number;
        el.meColor.textContent = `Team ${msg.teamName} · #${msg.number}`;
        state.attack = msg.team === "left" ? "you attack →" : "← you attack";
        renderAttack(msg.team);
        renderTilt();
        document.documentElement.style.setProperty("--me", msg.color);
        break;
      case "score":
        renderScore(msg);
        break;
      case "pick":
        showTeamPick(msg.counts || {});
        break;
      case "star":
        setStar(Boolean(msg.on));
        break;
      case "big":
        setBig(Boolean(msg.on));
        break;
      case "flower":
        setFlower(Boolean(msg.on), msg.points);
        break;
      case "goal":
        renderScore(msg.score || {});
        flashGoal(msg);
        break;
      case "host-left":
        showOverlay("The big screen went away. Waiting for it to come back…");
        break;
      case "host-back":
        hideOverlay();
        break;
      case "full":
        showJoin("That match is full — 12 players max.");
        break;
    }
  }

  // Mini pitch: the goal you defend is your colour; the other one is where you score.
  function renderAttack(team) {
    const left = team === "left";
    el.attackBar.hidden = false;
    el.attackBar.dataset.team = team;
    el.goalLeftLabel.textContent = left ? "🛡 Defend" : "⚽ Score";
    el.goalRightLabel.textContent = left ? "⚽ Score" : "🛡 Defend";
    el.attackArrow.textContent = left ? "Attack →→→" : "←←← Attack";
  }

  // Counts include this player on the team they were dealt onto, so leave them out of it.
  function showTeamPick(counts) {
    for (const team of ["left", "right"]) {
      const n = Math.max(0, (Number(counts[team]) || 0) - (state.team === team ? 1 : 0));
      el[team === "left" ? "pickLeft" : "pickRight"].textContent = n === 1 ? "1 player" : `${n} players`;
    }
    el.teamPick.hidden = false;
  }

  function setStar(on) {
    document.body.classList.toggle("is-star", on);
    if (on) powerFlash("is-star", "⭐ INVINCIBLE!", "Run through anyone — only you can touch the ball", [80, 40, 80, 40, 160]);
  }

  function setBig(on) {
    document.body.classList.toggle("is-big", on);
    if (on) powerFlash("is-big", "🍄 HUGE!", "You're giant — shove everyone out of the way", [200, 60, 300]);
  }

  function setFlower(on, points) {
    document.body.classList.toggle("is-flower", on);
    const n = Number.isInteger(points) ? points : 5;
    if (on) powerFlash("is-flower", "🌸 FLOWER POWER!", `Your goals count ${n}× — go score!`, [60, 30, 60, 30, 60, 30, 200]);
  }

  function powerFlash(kind, text, sub, buzz) {
    if (navigator.vibrate) navigator.vibrate(buzz);
    el.goalFlash.classList.remove("is-ours", "is-star", "is-big", "is-flower");
    el.goalFlash.classList.add(kind);
    el.goalFlashText.textContent = text;
    el.goalFlashWho.textContent = sub;
    el.goalFlash.hidden = false;
    clearTimeout(state.goalTimer);
    state.goalTimer = setTimeout(() => (el.goalFlash.hidden = true), 2200);
  }

  function renderScore({ left, right }) {
    if (Number.isInteger(left)) el.scoreLeft.textContent = left;
    if (Number.isInteger(right)) el.scoreRight.textContent = right;
  }

  function flashGoal(msg) {
    el.goalFlash.classList.remove("is-star", "is-big", "is-flower");
    const ours = msg.team === state.team;
    const mine = msg.scorerId === state.id;
    el.goalFlash.classList.toggle("is-ours", ours);
    const bonus = msg.points > 1 ? `${msg.points}× ` : "";
    el.goalFlashText.textContent = ours ? (mine && !msg.ownGoal ? `YOU SCORED${bonus ? ` ${msg.points}` : ""}!` : `${bonus}GOAL!`) : `Conceded${bonus ? ` ${msg.points}` : ""}`;
    el.goalFlashWho.textContent = msg.scorerName ? (msg.ownGoal ? `Own goal · ${msg.scorerName}` : msg.scorerName) : "";
    el.goalFlash.hidden = false;
    clearTimeout(state.goalTimer);
    state.goalTimer = setTimeout(() => (el.goalFlash.hidden = true), 2200);
  }

  function handleStatus(status) {
    el.status.dataset.state = status;
    if (status === "no-host") showJoin(`Room ${state.room} isn't open. Check the code on the big screen.`);
    else if (status === "full") showJoin("That match is full — 12 players max.");
    else if (status === "replaced") showOverlay("You're playing from another tab.", "Play here", () => state.link.connect());
    else if (status === "reconnecting" && state.link && state.link.attempt > 1) showOverlay("Reconnecting…");
    else if (status === "open") hideOverlay();
  }

  function showOverlay(text, actionLabel, action) {
    el.overlayText.textContent = text;
    el.overlayBtn.hidden = !actionLabel;
    el.overlayBtn.textContent = actionLabel || "";
    el.overlayBtn.onclick = () => {
      hideOverlay();
      action && action();
    };
    el.overlay.hidden = false;
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  // ---------- Face photo ----------
  function loadFace() {
    try {
      const saved = localStorage.getItem(FACE_KEY);
      state.face = F.isFaceDataUrl(saved) ? saved : null;
    } catch {
      state.face = null;
    }
  }

  function saveFace(dataUrl) {
    state.face = dataUrl;
    try {
      if (dataUrl) localStorage.setItem(FACE_KEY, dataUrl);
      else localStorage.removeItem(FACE_KEY);
    } catch {
      // Private mode etc.; the face still works for this session.
    }
    renderFace();
    sendFace();
  }

  // Sent after every "you" (so a reloaded big screen gets it again) and whenever the photo changes.
  function sendFace() {
    if (!state.link || state.link.status !== "open") return;
    for (const chunk of F.chunkFace(state.face, ++state.faceSeq)) state.link.send(chunk);
  }

  function renderFace() {
    el.faceImg.hidden = !state.face;
    el.faceBlank.hidden = Boolean(state.face);
    if (state.face) el.faceImg.src = state.face;
    el.faceBtn.textContent = state.face ? "Retake" : "Take selfie";
    el.faceClear.hidden = !state.face;
    el.faceHint.textContent = state.face ? "You'll play with this face" : "Optional — play as yourself";
    // Team colour outside the oval, the photo inside it.
    el.meSwatch.style.backgroundImage = state.face
      ? `radial-gradient(36.9% 50% at center, transparent 96%, var(--me, #64748b) 100%), url("${state.face}")`
      : "";
    el.meSwatch.classList.toggle("has-face", Boolean(state.face));
  }

  function camMessage(err) {
    if (!window.isSecureContext) return "The camera needs an https:// page.";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "This browser can't use the camera.";
    if (err && err.name === "NotAllowedError") return "Camera access was blocked. Allow it in your browser settings, or skip the photo.";
    if (err && err.name === "NotFoundError") return "No camera found on this device.";
    return "Couldn't start the camera.";
  }

  async function openCamera() {
    el.cam.hidden = false;
    el.camError.hidden = true;
    showCamShot(null);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw null;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      if (el.cam.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      state.cam = stream;
      el.camVideo.srcObject = stream;
      await el.camVideo.play().catch(() => {});
    } catch (err) {
      el.camError.textContent = camMessage(err);
      el.camError.hidden = false;
      el.camSnap.hidden = true;
    }
  }

  function closeCamera() {
    if (state.cam) state.cam.getTracks().forEach((t) => t.stop());
    state.cam = null;
    el.camVideo.srcObject = null;
    el.cam.hidden = true;
  }

  function showCamShot(dataUrl) {
    el.camShot.hidden = !dataUrl;
    el.camVideo.hidden = Boolean(dataUrl);
    if (dataUrl) el.camShot.src = dataUrl;
    else el.camShot.removeAttribute("src");
    el.camSnap.hidden = Boolean(dataUrl);
    el.camRetake.hidden = !dataUrl;
    el.camUse.hidden = !dataUrl;
  }

  // The view is a square showing the video with object-fit: cover, so its visible area is the
  // centred square of the frame; crop the part framed by the oval and mirror it like the preview.
  function snap() {
    const v = el.camVideo;
    if (!v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight) * F.FACE_CROP;
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = F.FACE_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.translate(F.FACE_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, side, side, 0, 0, F.FACE_SIZE, F.FACE_SIZE);
    let dataUrl = null;
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      dataUrl = canvas.toDataURL("image/jpeg", q);
      if (F.isFaceDataUrl(dataUrl)) break;
    }
    if (!F.isFaceDataUrl(dataUrl)) {
      el.camError.textContent = "Couldn't process that photo — try again.";
      el.camError.hidden = false;
      return;
    }
    el.camError.hidden = true;
    showCamShot(dataUrl);
  }

  // ---------- Input ----------
  function currentVector() {
    if (state.drag) return { x: state.drag.x, y: state.drag.y };
    if (state.tilt.on) return { x: state.tilt.x, y: state.tilt.y };
    return { x: 0, y: 0 };
  }

  function flush() {
    if (!state.link) return;
    const v = currentVector();
    const msg = { t: "in", x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, k: state.kicks };
    const key = `${msg.x},${msg.y},${msg.k}`;
    if (key === state.lastSent) return;
    if (state.link.send(msg)) state.lastSent = key;
  }

  function setKnob(x, y) {
    el.stickKnob.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
  }

  function onPointerDown(ev) {
    if (state.drag) return;
    el.stickArea.setPointerCapture(ev.pointerId);
    const rect = el.stickArea.getBoundingClientRect();
    state.drag = { id: ev.pointerId, ox: ev.clientX, oy: ev.clientY, x: 0, y: 0 };
    el.stickBase.style.left = `${ev.clientX - rect.left}px`;
    el.stickBase.style.top = `${ev.clientY - rect.top}px`;
    el.stickArea.classList.add("is-dragging");
    setKnob(0, 0);
  }

  function onPointerMove(ev) {
    const d = state.drag;
    if (!d || ev.pointerId !== d.id) return;
    let x = (ev.clientX - d.ox) / STICK_RADIUS;
    let y = (ev.clientY - d.oy) / STICK_RADIUS;
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    d.x = x;
    d.y = y;
    setKnob(x, y);
  }

  function onPointerUp(ev) {
    if (!state.drag || ev.pointerId !== state.drag.id) return;
    state.drag = null;
    el.stickArea.classList.remove("is-dragging");
    el.stickBase.style.left = "";
    el.stickBase.style.top = "";
    setKnob(state.tilt.on ? state.tilt.x : 0, state.tilt.on ? state.tilt.y : 0);
  }

  function kick() {
    const now = performance.now();
    if (now < state.kickReadyAt) return;
    state.kicks++;
    state.kickReadyAt = now + KICK_COOLDOWN_MS;
    flush();
    el.kickBtn.classList.remove("is-charging");
    void el.kickBtn.offsetWidth;
    el.kickBtn.classList.add("is-charging");
  }

  // ---------- Tilt ----------
  function screenAngle() {
    const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    return ((a % 360) + 360) % 360;
  }

  function onOrientation(ev) {
    if (ev.beta == null || ev.gamma == null) return;
    const angle = screenAngle();
    let x = ev.gamma;
    let y = ev.beta;
    if (angle === 90) [x, y] = [ev.beta, -ev.gamma];
    else if (angle === 270) [x, y] = [-ev.beta, ev.gamma];
    else if (angle === 180) [x, y] = [-ev.gamma, -ev.beta];
    if (!state.tilt.neutral) state.tilt.neutral = { x, y };
    state.tilt.x = clamp((x - state.tilt.neutral.x) / TILT_RANGE_DEG);
    state.tilt.y = clamp((y - state.tilt.neutral.y) / TILT_RANGE_DEG);
    if (!state.drag) setKnob(state.tilt.x, state.tilt.y);
  }

  async function toggleTilt() {
    if (state.tilt.on) {
      state.tilt.on = false;
      window.removeEventListener("deviceorientation", onOrientation);
      setKnob(0, 0);
      renderTilt();
      return;
    }
    if (!("DeviceOrientationEvent" in window)) {
      flashHint("This device has no tilt sensor — drag to run.");
      return;
    }
    if (!window.isSecureContext) {
      flashHint("Tilt needs an https:// page — drag to run for now.");
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") {
          flashHint("Motion access was denied. Allow it in Safari settings, or drag to run.");
          return;
        }
      }
    } catch {
      flashHint("Couldn't turn on tilt — drag to run.");
      return;
    }
    state.tilt = { on: true, x: 0, y: 0, neutral: null };
    window.addEventListener("deviceorientation", onOrientation);
    renderTilt();
    flashHint("Hold the phone how you like — that's level. Tilt to run.");
  }

  function renderTilt() {
    el.tiltBtn.classList.toggle("is-active", state.tilt.on);
    el.tiltBtn.setAttribute("aria-pressed", String(state.tilt.on));
    el.tiltLabel.textContent = state.tilt.on ? "Tilt on" : "Tilt";
    const attack = state.attack ? ` · ${state.attack}` : "";
    el.stickHint.textContent = state.tilt.on ? `Tilt to run${attack}` : `Drag anywhere to run${attack}`;
  }

  let hintTimer = null;
  function flashHint(text) {
    el.stickHint.textContent = text;
    el.stickHint.classList.add("is-flash");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      el.stickHint.classList.remove("is-flash");
      renderTilt();
    }, 3500);
  }

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible" && !state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => (state.wakeLock = null));
      }
    } catch {
      // Unsupported or not allowed; the screen may dim, which is fine.
    }
  }

  function bind() {
    [
      "joinScreen", "playScreen", "joinForm", "roomInput", "nameInput", "joinError", "meSwatch", "meName", "meColor", "meRoom",
      "status", "leaveBtn", "stickArea", "stickBase", "stickKnob", "stickHint", "tiltBtn", "tiltLabel", "overlay",
      "overlayText", "overlayBtn", "meNumber", "scoreLeft", "scoreRight", "kickBtn", "goalFlash", "goalFlashText", "goalFlashWho",
      "appVersion", "faceThumb", "faceImg", "faceBlank", "faceHint", "faceBtn", "faceClear", "cam", "camVideo", "camShot",
      "camError", "camCancel", "camSnap", "camRetake", "camUse", "teamPick", "pickLeft", "pickRight", "attackBar", "goalLeftLabel", "goalRightLabel", "attackArrow",
    ].forEach((id) => (el[id] = $(id)));
    el.appVersion.textContent = `v${util.APP_VERSION}`;

    el.roomInput.addEventListener("input", () => {
      el.roomInput.value = el.roomInput.value.toUpperCase().replace(/[^A-Z]/g, "").replace(/[IO]/g, "");
    });
    el.joinForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const room = el.roomInput.value.trim().toUpperCase();
      const name = el.nameInput.value.trim().slice(0, 16);
      if (!util.isRoomCode(room)) return showJoin("Room codes are 4 letters, like KXRM.");
      if (!name) return showJoin("Enter your name.");
      join(room, name);
    });
    el.leaveBtn.addEventListener("click", () => showJoin());

    el.teamPick.addEventListener("click", (ev) => {
      const opt = ev.target.closest("[data-team]");
      if (!opt || !state.link) return;
      state.link.send({ t: "team", team: opt.dataset.team });
      el.teamPick.hidden = true;
    });

    el.faceBtn.addEventListener("click", openCamera);
    el.faceThumb.addEventListener("click", openCamera);
    el.meSwatch.addEventListener("click", openCamera);
    el.faceClear.addEventListener("click", () => saveFace(null));
    el.camCancel.addEventListener("click", closeCamera);
    el.camSnap.addEventListener("click", snap);
    el.camRetake.addEventListener("click", () => showCamShot(null));
    el.camUse.addEventListener("click", () => {
      saveFace(el.camShot.getAttribute("src"));
      closeCamera();
    });

    el.stickArea.addEventListener("pointerdown", onPointerDown);
    el.stickArea.addEventListener("pointermove", onPointerMove);
    el.stickArea.addEventListener("pointerup", onPointerUp);
    el.stickArea.addEventListener("pointercancel", onPointerUp);

    el.kickBtn.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      kick();
    });
    el.kickBtn.addEventListener("contextmenu", (ev) => ev.preventDefault());
    el.tiltBtn.addEventListener("click", toggleTilt);

    document.addEventListener("gesturestart", (ev) => ev.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        state.drag = null;
        if (state.link) state.link.send({ t: "in", x: 0, y: 0, k: state.kicks });
      } else {
        state.lastSent = "";
        if (state.link && state.link.status !== "open" && !el.playScreen.hidden) state.link.connect();
        keepAwake();
      }
    });
  }

  function init() {
    bind();
    loadFace();
    renderFace();
    util.applyTheme();
    const params = new URLSearchParams(location.search);
    const room = (params.get("room") || "").toUpperCase();
    const name = localStorage.getItem(NAME_KEY) || "";
    el.roomInput.value = util.isRoomCode(room) ? room : "";
    el.nameInput.value = name;
    if (util.isRoomCode(room) && name) join(room, name);
    else (util.isRoomCode(room) ? el.nameInput : el.roomInput).focus();
    V.controller = state;
  }

  init();
})();
