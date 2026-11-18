/* Uncinus — canvas renderer: a pitch floating on a bank of cloud. Reads match state; never mutates it. */
(function (root) {
  "use strict";

  // Smart-TV browsers often run an older Chromium without ctx.roundRect (Chrome 99+). Without it the very first
  // frame throws, so draw rounded rectangles with arcs instead.
  const ctxProto = root.CanvasRenderingContext2D && root.CanvasRenderingContext2D.prototype;
  if (ctxProto && !ctxProto.roundRect) {
    ctxProto.roundRect = function (x, y, w, h, radii) {
      const r = Math.max(0, Math.min(Number(Array.isArray(radii) ? radii[0] : radii) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  const U = root.Uncinus;
  const M = U.match;
  const { W, H, PITCH, CX, CY, GOAL_HALF, GOAL_DEPTH, POST_R, HALF, BALL_R, TEAMS, STAR_R, STAR_LIFE, SHROOM_R, SHROOM_LIFE, FLOWER_R, FLOWER_LIFE, BRICK_R, BRICK_LIFE } = M;
  const { FACE_OVAL } = U.face;
  // The frame of a face player: the same outline as a block's "Kick ready" ring (block + 9 px lift + 4 px margin).
  const FRAME = { half: HALF + 4, top: HALF + 4, bottom: HALF + 13 };
  const APRON = 30;
  // Goal replays (seconds). The clip runs from `before` the goal to `after` it, at full speed until `slowBefore`
  // the goal and then at `slowmo` speed; it starts `delay` after the goal and dissolves out over `outro`.
  const REPLAY = {
    keep: 4, delay: 1.3, before: 2.0, after: 0.5, slowBefore: 0.7, slowmo: 0.45, intro: 0.35, outro: 0.35,
    zoom: [1.9, 2.6], pixels: [24, 480], // pixels: replay width in pixels, dissolving from the first to the second
  };
  // From the goal to the end of the replay: the host holds the kickoff this long.
  REPLAY.time = REPLAY.delay + (REPLAY.before - REPLAY.slowBefore) + (REPLAY.slowBefore + REPLAY.after) / REPLAY.slowmo + REPLAY.outro;

  const PALETTES = {
    day: {
      skyTop: "#3b82d6", skyMid: "#7dbcef", skyHorizon: "#d8eefb",
      cloudLit: "#ffffff", cloudMid: "#edf3fb", cloudShade: "#b4c3d9", ambientAlpha: 0.8,
      grassA: "#5fae4e", grassB: "#56a246", apron: "#4f9440", earth: "#7a5a3c", earthDark: "#5a4029",
      line: "rgba(255,255,255,0.9)", net: "rgba(255,255,255,0.55)", netBg: "rgba(255,255,255,0.12)",
      shadow: "rgba(10, 40, 10, 0.28)", flood: 0, tagBg: "rgba(255,255,255,0.85)", tagInk: "#0f172a",
    },
    twilight: {
      skyTop: "#251f52", skyMid: "#8a4c8c", skyHorizon: "#ffb27a",
      cloudLit: "#ffd9c4", cloudMid: "#e3a9bb", cloudShade: "#7a6a9c", ambientAlpha: 0.7,
      grassA: "#4c7a46", grassB: "#45703f", apron: "#3e6438", earth: "#5b4038", earthDark: "#3f2c28",
      line: "rgba(255,240,235,0.85)", net: "rgba(255,235,230,0.5)", netBg: "rgba(255,255,255,0.08)",
      shadow: "rgba(20, 10, 30, 0.32)", flood: 0.35, tagBg: "rgba(40,30,70,0.8)", tagInk: "#fbf7ff",
    },
    night: {
      skyTop: "#040814", skyMid: "#0c1730", skyHorizon: "#22355c",
      cloudLit: "#9aa9cc", cloudMid: "#5e6f96", cloudShade: "#273352", ambientAlpha: 0.5,
      grassA: "#2f5a35", grassB: "#2a5230", apron: "#244829", earth: "#2c2420", earthDark: "#1c1714",
      line: "rgba(235,245,255,0.85)", net: "rgba(220,230,255,0.45)", netBg: "rgba(255,255,255,0.06)",
      shadow: "rgba(0, 0, 0, 0.35)", flood: 1, tagBg: "rgba(10,16,32,0.8)", tagInk: "#f1f5f9",
    },
  };

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  function buildScenery() {
    const rand = rng(11);
    const bank = [];
    const x0 = PITCH.L - GOAL_DEPTH - APRON;
    const x1 = PITCH.R + GOAL_DEPTH + APRON;
    const y0 = PITCH.T - APRON;
    const y1 = PITCH.B + APRON;
    const edge = (ax, ay, bx, by, ox, oy) => {
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d <= len; d += 60) {
        const u = d / len;
        bank.push({ x: ax + (bx - ax) * u + ox * (20 + rand() * 25), y: ay + (by - ay) * u + oy * (20 + rand() * 25), r: 40 + rand() * 38 });
      }
    };
    edge(x0, y1, x1, y1, 0, 1);
    edge(x0, y0, x1, y0, 0, -0.4);
    edge(x0, y0, x0, y1, -1, 0);
    edge(x1, y0, x1, y1, 1, 0);
    const ambient = [];
    for (let i = 0; i < 6; i++) ambient.push({ x: rand() * W, y: 30 + rand() * 90, s: 0.4 + rand() * 0.5, v: 5 + rand() * 10, seed: Math.floor(rand() * 1e9) });
    const stars = [];
    for (let i = 0; i < 120; i++) stars.push({ x: rand() * W, y: rand() * H, r: 0.5 + rand() * 1.3, tw: rand() * 6.28 });
    return { bank, ambient, stars, box: { x0, x1, y0, y1 } };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.scenery = buildScenery();
      this.theme = "day";
      this.trails = new Map();
      this.fx = [];
      this.rand = rng(5);
      this.faces = null;
      this.maxDpr = 2;
      this.history = []; // recent snapshots for goal replays
      this.replays = true;
      this.replay = null;
      this.replayQueue = null;
      this.onReplay = null;
      this.resize();
    }

    setTheme(theme) {
      this.theme = PALETTES[theme] ? theme : "day";
    }

    // Slow screens (TV browsers) can trade sharpness for frame rate.
    setMaxDpr(value) {
      this.maxDpr = value;
      this.resize();
    }

    resize() {
      const dpr = Math.min(this.maxDpr, root.devicePixelRatio || 1);
      const w = this.canvas.clientWidth || root.innerWidth;
      const h = this.canvas.clientHeight || root.innerHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const scale = Math.min(w / W, h / H);
      this.view = { w, h, dpr, scale, ox: (w - W * scale) / 2, oy: (h - H * scale) / 2 };
    }

    // Effects driven by match events (called by the host as it drains them).
    onEvent(ev, m) {
      if (ev.type === "period" && ev.period === "full") this.burst(CX, CY, 120, ["#38bdf8", "#fb923c", "#fde047", "#ffffff"]);
      if (ev.type === "cheer") {
        // Spectators' cheers float up from below the pitch.
        if (this.fx.filter((f) => f.kind === "emoji").length > 40) return;
        this.fx.push({
          kind: "emoji", emoji: ev.emoji, x: 120 + this.rand() * (W - 240), y: H + 10, vx: (this.rand() - 0.5) * 60, vy: -240 - this.rand() * 140,
          rot: 0, age: 0, life: 2.4, size: 34 + this.rand() * 14,
        });
      } else if (ev.type === "kick") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.45, color: "#ffffff" });
      } else if (ev.type === "star-spawn") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.6, color: "#fde047" });
      } else if (ev.type === "shroom-spawn") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.6, color: "#ef4444" });
      } else if (ev.type === "flower-spawn") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.6, color: "#fb923c" });
      } else if (ev.type === "flower-get") {
        for (let i = 0; i < 30; i++) {
          const a = this.rand() * Math.PI * 2;
          const sp = 100 + this.rand() * 260;
          this.fx.push({
            kind: "confetti", x: ev.x, y: ev.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150,
            rot: this.rand() * 6, age: 0, life: 1 + this.rand() * 0.5, color: ["#f97316", "#fde047", "#ef4444"][i % 3], size: 5 + this.rand() * 4,
          });
        }
      } else if (ev.type === "brick-spawn") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.6, color: "#b91c1c" });
      } else if (ev.type === "brick-get") {
        for (let i = 0; i < 24; i++) {
          const a = this.rand() * Math.PI * 2;
          const sp = 90 + this.rand() * 240;
          this.fx.push({
            kind: "confetti", x: ev.x, y: ev.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
            rot: this.rand() * 6, age: 0, life: 0.9 + this.rand() * 0.5, color: ["#b91c1c", "#ea580c", "#fecaca"][i % 3], size: 7 + this.rand() * 4,
          });
        }
      } else if (ev.type === "turkey-spawn") {
        this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.6, color: "#b45309" });
      } else if (ev.type === "turkey-hop") {
        this.feathers(ev.x, ev.y, 6, 140);
      } else if (ev.type === "turkey-get") {
        this.feathers(ev.x, ev.y, 46, 320);
      } else if (ev.type === "shroom-get") {
        for (let i = 0; i < 3; i++) this.fx.push({ kind: "ring", x: ev.x, y: ev.y, age: 0, life: 0.5 + i * 0.25, color: i ? "#ef4444" : "#ffffff" });
      } else if (ev.type === "star-get") {
        for (let i = 0; i < 40; i++) {
          const a = this.rand() * Math.PI * 2;
          const sp = 120 + this.rand() * 300;
          this.fx.push({
            kind: "confetti", x: ev.x, y: ev.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150,
            rot: this.rand() * 6, age: 0, life: 1 + this.rand() * 0.6, color: i % 2 ? "#fde047" : "#ffffff", size: 5 + this.rand() * 5,
          });
        }
      } else if (ev.type === "goal") {
        this.queueReplay(ev, m);
        const color = TEAMS[ev.team].color;
        const gx = M.defends(m, ev.team) === "left" ? PITCH.R + GOAL_DEPTH / 2 : PITCH.L - GOAL_DEPTH / 2;
        for (let i = 0; i < 90; i++) {
          const a = this.rand() * Math.PI * 2;
          const sp = 150 + this.rand() * 450;
          this.fx.push({
            kind: "confetti", x: gx, y: CY + (this.rand() - 0.5) * GOAL_HALF * 1.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200,
            rot: this.rand() * 6, age: 0, life: 1.6 + this.rand(), color: i % 3 === 0 ? "#ffffff" : color, size: 6 + this.rand() * 6,
          });
        }
      }
    }

    // Turkey feathers flying: brown, rust, cream and a little red.
    feathers(x, y, count, speed) {
      const colors = ["#92400e", "#b45309", "#c2410c", "#fef3c7", "#78350f", "#dc2626"];
      for (let i = 0; i < count; i++) {
        const a = this.rand() * Math.PI * 2;
        const sp = speed * (0.4 + this.rand() * 0.6);
        this.fx.push({
          kind: "confetti", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.4,
          rot: this.rand() * 6, age: 0, life: 0.9 + this.rand() * 0.7, color: colors[i % colors.length], size: 7 + this.rand() * 5,
        });
      }
    }

    // A confetti explosion (full time, the championship trophy).
    burst(x, y, count, colors) {
      for (let i = 0; i < count; i++) {
        const a = this.rand() * Math.PI * 2;
        const sp = 150 + this.rand() * 450;
        this.fx.push({
          kind: "confetti", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 250,
          rot: this.rand() * 6, age: 0, life: 2 + this.rand(), color: colors[i % colors.length], size: 6 + this.rand() * 6,
        });
      }
    }

    render(m, dt) {
      if (this.replay) {
        if (this.renderReplay(m, dt)) return;
      } else if (this.replayQueue && m.t >= this.replayQueue.at) {
        if (this.startReplay(m) && this.renderReplay(m, dt)) return;
      }
      if (this.replayQueue && m.phase !== "goal") this.replayQueue = null;
      this.record(m);
      this.t = m.t;
      const ctx = this.ctx;
      const { dpr, scale, ox, oy, w, h } = this.view;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      const bounds = { x0: -ox / scale - 2, x1: (w - ox) / scale + 2, y0: -oy / scale - 2, y1: (h - oy) / scale + 2 };
      this.drawScene(ctx, PALETTES[this.theme], m, dt, bounds, true);
    }

    // Everything on the pitch, in logical coordinates. `live` = the real match (a replay skips trails and effects).
    drawScene(ctx, pal, m, dt, bounds, live) {
      const { x0: vx0, x1: vx1, y0: vy0, y1: vy1 } = bounds;
      const sky = ctx.createLinearGradient(0, vy0, 0, vy1);
      sky.addColorStop(0, pal.skyTop);
      sky.addColorStop(0.6, pal.skyMid);
      sky.addColorStop(1, pal.skyHorizon);
      ctx.fillStyle = sky;
      ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      if (this.theme !== "day") {
        ctx.fillStyle = "#ffffff";
        for (const s of this.scenery.stars) {
          ctx.globalAlpha = (this.theme === "night" ? 0.85 : 0.3) * (0.55 + 0.45 * Math.sin(m.t * 1.3 + s.tw));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      for (const a of this.scenery.ambient) {
        if (live) {
          a.x += a.v * dt;
          if (a.x > W + 200) a.x = -200;
        }
        this.drawPuffCloud(ctx, a, pal);
      }

      this.drawIsland(ctx, pal);
      this.drawPitch(ctx, pal, m);
      this.drawNets(ctx, pal, "back", m);

      const players = [...m.players.values()].sort((a, b) => a.y - b.y);
      if (live) this.updateTrails(players, dt);
      for (const p of players) {
        const s = p.scale || 1;
        // Face players are see-through inside their frame, so their shadow sits just below it.
        if (this.faceOf(p)) this.drawShadow(ctx, pal, p.x, p.y + (FRAME.bottom + 4) * s, HALF * 1.1 * s, 6 * s, p.connected ? 0.8 : 0.3);
        else this.drawShadow(ctx, pal, p.x, p.y + (HALF + 6) * s, HALF * 1.25 * s, 9 * s, p.connected ? 1 : 0.4);
      }
      if (m.shroom) this.drawShroom(ctx, pal, m.shroom);
      if (m.flower) this.drawFlower(ctx, pal, m.flower);
      if (m.brick) this.drawBrick(ctx, pal, m.brick);
      this.drawShadow(ctx, pal, m.ball.x + 5, m.ball.y + BALL_R * 0.8, BALL_R * 1.05, 5, 1);
      if (live) this.drawTrails(ctx, players);
      for (const p of players) {
        // Mushroom-sized players are drawn scaled about their centre.
        const s = p.scale || 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(s, s);
        ctx.translate(-p.x, -p.y);
        if (p.flower > 0) this.drawFlowerAura(ctx, p);
        this.drawPlayer(ctx, p);
        if (p.star > 0) this.drawStarAura(ctx, p);
        if (p.flower > 0) this.drawFlowerBadge(ctx, p, m.flowerPoints);
        if (p.brick > 0) this.drawBrickBadge(ctx, p);
        ctx.restore();
        if (p.coma > 0) this.drawComa(ctx, p);
      }
      if (m.turkey) this.drawTurkey(ctx, pal, m.turkey);
      if (m.star) this.drawStar(ctx, m.star);
      this.drawBall(ctx, m.ball);
      this.drawNets(ctx, pal, "front", m);
      if (live) this.drawFx(ctx, dt);
      if (pal.flood > 0) this.drawFloodlights(ctx, pal);
      for (const p of players) this.drawTag(ctx, pal, p);
    }

    // ---------- Goal replays ----------
    // A rolling few seconds of the match, so a goal can be shown again: zoomed in, pixelated like an old
    // broadcast, the camera tracking the ball and the scorer, slowing right down for the finish.
    record(m) {
      const buf = this.history;
      const lastSnap = buf[buf.length - 1];
      if (lastSnap && m.t < lastSnap.t) buf.length = 0; // a fresh match
      else if (lastSnap && m.t - lastSnap.t < 1 / 90) return;
      const copy = (o) => (o ? Object.assign({}, o) : null);
      const players = [];
      for (const p of m.players.values()) players.push(Object.assign({}, p));
      buf.push({
        t: m.t, players, ball: copy(m.ball), mouth: copy(m.mouth), swapped: m.swapped, flowerPoints: m.flowerPoints,
        star: copy(m.star), shroom: copy(m.shroom), flower: copy(m.flower), brick: copy(m.brick), turkey: copy(m.turkey),
      });
      while (buf.length && buf[0].t < m.t - REPLAY.keep) buf.shift();
    }

    // Called on every goal; the replay starts once the GOAL! banner has had its moment.
    queueReplay(ev, m) {
      if (!this.replays) return;
      this.replayQueue = { goalT: m.t, at: m.t + REPLAY.delay, team: ev.team, scorerId: ev.scorerId, scorerName: ev.scorerName, ownGoal: ev.ownGoal };
    }

    startReplay(m) {
      const q = this.replayQueue;
      this.replayQueue = null;
      if (m.phase !== "goal") return false;
      const clip = this.history.filter((s) => s.t >= q.goalT - REPLAY.before && s.t <= q.goalT + REPLAY.after);
      if (clip.length < 4) return false;
      this.replay = Object.assign({}, q, { clip, start: clip[0].t, c: clip[0].t, end: clip[clip.length - 1].t, i: 0, age: 0, hold: 0, cam: null });
      if (this.onReplay) this.onReplay(true, this.replay);
      return true;
    }

    stopReplay() {
      if (!this.replay) return;
      this.replay = null;
      this.history.length = 0;
      this.fx = this.fx.filter((f) => f.kind === "emoji"); // the goal confetti has had its moment
      if (this.onReplay) this.onReplay(false);
    }

    // The match as it was at clip time c, with positions blended between the two nearest snapshots.
    snapshotAt(r, c) {
      const clip = r.clip;
      while (r.i < clip.length - 2 && clip[r.i + 1].t <= c) r.i++;
      const a = clip[r.i];
      const b = clip[Math.min(r.i + 1, clip.length - 1)];
      const u = b.t > a.t ? Math.min(1, Math.max(0, (c - a.t) / (b.t - a.t))) : 0;
      const lerp = (x, y) => x + (y - x) * u;
      const later = new Map(b.players.map((p) => [p.id, p]));
      const players = new Map();
      for (const p of a.players) {
        const q = later.get(p.id) || p;
        players.set(p.id, Object.assign({}, p, { x: lerp(p.x, q.x), y: lerp(p.y, q.y), scale: lerp(p.scale || 1, q.scale || 1) }));
      }
      const ball = Object.assign({}, a.ball, { x: lerp(a.ball.x, b.ball.x), y: lerp(a.ball.y, b.ball.y), spin: lerp(a.ball.spin, b.ball.spin) });
      const mouth = { left: lerp(a.mouth.left, b.mouth.left), right: lerp(a.mouth.right, b.mouth.right) };
      return Object.assign({}, a, { t: c, players, ball, mouth });
    }

    // Draws one replay frame; returns false once the replay is over (the caller then draws the live match).
    renderReplay(m, dt) {
      const r = this.replay;
      if (m.phase !== "goal") {
        this.stopReplay();
        return false;
      }
      r.age += dt;
      const slow = r.c >= r.goalT - REPLAY.slowBefore;
      r.c = Math.min(r.end, r.c + dt * (slow ? REPLAY.slowmo : 1));
      if (r.c >= r.end) r.hold += dt;
      if (r.hold >= REPLAY.outro) {
        this.stopReplay();
        return false;
      }
      const snap = this.snapshotAt(r, r.c);
      this.t = r.c;

      // Camera: on the ball, leaning toward the scorer while they're close, zooming in as the goal nears.
      const ball = snap.ball;
      const hero = r.scorerId ? snap.players.get(r.scorerId) : null;
      let fx = ball.x;
      let fy = ball.y;
      if (hero && Math.hypot(hero.x - ball.x, hero.y - ball.y) < 450) {
        fx = ball.x * 0.62 + hero.x * 0.38;
        fy = ball.y * 0.62 + hero.y * 0.38;
      }
      const prog = Math.min(1, Math.max(0, (r.c - r.start) / Math.max(0.1, r.goalT - r.start)));
      const zoom = REPLAY.zoom[0] + (REPLAY.zoom[1] - REPLAY.zoom[0]) * prog;
      if (!r.cam) r.cam = { x: fx, y: fy, z: zoom };
      const k = 1 - Math.exp(-5 * dt);
      r.cam.x += (fx - r.cam.x) * k;
      r.cam.y += (fy - r.cam.y) * k;
      r.cam.z += (zoom - r.cam.z) * k;
      const { w, h, scale, dpr } = this.view;
      const vw = w / scale / r.cam.z;
      const vh = h / scale / r.cam.z;
      const fit = (v, lo, hi, span) => (hi - lo <= span ? (lo + hi) / 2 : Math.min(hi - span / 2, Math.max(lo + span / 2, v)));
      const cx = fit(r.cam.x, PITCH.L - GOAL_DEPTH - 45, PITCH.R + GOAL_DEPTH + 45, vw);
      const cy = fit(r.cam.y, PITCH.T - 110, PITCH.B + 90, vh);

      // Pixelated: draw small, then blow it up without smoothing. It dissolves in and out through big blocks.
      const fade = Math.min(1, r.age / REPLAY.intro, 1 - r.hold / REPLAY.outro);
      const ease = fade * fade * (3 - 2 * fade);
      const pw = Math.max(8, Math.round(REPLAY.pixels[0] + (REPLAY.pixels[1] - REPLAY.pixels[0]) * ease));
      const ph = Math.max(5, Math.round((pw * h) / w));
      const off = this.replayCanvas || (this.replayCanvas = root.document.createElement("canvas"));
      if (off.width !== pw || off.height !== ph) {
        off.width = pw;
        off.height = ph;
      }
      const octx = off.getContext("2d");
      const s = pw / vw;
      octx.setTransform(s, 0, 0, s, pw / 2 - cx * s, ph / 2 - cy * s);
      const pal = PALETTES[this.theme];
      this.drawScene(octx, pal, snap, 0, { x0: cx - vw / 2 - 2, x1: cx + vw / 2 + 2, y0: cy - vh / 2 - 2, y1: cy + vh / 2 + 2 }, false);
      if (hero) {
        // A pulsing ring picks out the scorer.
        const team = TEAMS[hero.team];
        const rad = HALF * (hero.scale || 1) * (1.7 + Math.sin(r.age * 8) * 0.15);
        octx.strokeStyle = team.color;
        octx.lineWidth = 5;
        octx.beginPath();
        octx.arc(hero.x, hero.y + 4, rad, 0, Math.PI * 2);
        octx.stroke();
        octx.strokeStyle = "#ffffff";
        octx.lineWidth = 2;
        octx.stroke();
      }

      const ctx = this.ctx;
      const cw = this.canvas.width;
      const chh = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, cw, chh);
      ctx.imageSmoothingEnabled = true;
      this.drawReplayOverlay(ctx, r, cw, chh, dpr, slow && r.c < r.end);
      return true;
    }

    // Broadcast dressing over the replay: scanlines, a vignette, a team-colour frame and a blinking REPLAY tag.
    drawReplayOverlay(ctx, r, cw, ch, dpr, slow) {
      if (!this.scanlines) {
        const tile = root.document.createElement("canvas");
        tile.width = 1;
        tile.height = 4;
        const t = tile.getContext("2d");
        t.fillStyle = "rgba(0, 0, 0, 0.22)";
        t.fillRect(0, 0, 1, 2);
        this.scanlines = ctx.createPattern(tile, "repeat");
      }
      ctx.fillStyle = this.scanlines;
      ctx.fillRect(0, 0, cw, ch);
      const v = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.6);
      v.addColorStop(0, "rgba(0, 0, 0, 0)");
      v.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, cw, ch);
      const color = TEAMS[r.team] ? TEAMS[r.team].color : "#ffffff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 10 * dpr;
      ctx.strokeRect(5 * dpr, 5 * dpr, cw - 10 * dpr, ch - 10 * dpr);

      const u = dpr * Math.min(1.6, Math.max(0.8, cw / dpr / 1280));
      const x = cw / 2;
      const y = ch - 92 * u;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.round(40 * u)}px ui-monospace, Menlo, Consolas, monospace`;
      const label = slow ? "REPLAY · SLOW-MO" : "REPLAY";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10, 14, 28, 0.78)";
      ctx.beginPath();
      ctx.roundRect(x - tw / 2 - 52 * u, y - 32 * u, tw + 82 * u, 64 * u, 12 * u);
      ctx.fill();
      if (Math.floor(r.age * 2.5) % 2 === 0) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(x - tw / 2 - 26 * u, y, 10 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + 8 * u, y + 2 * u);
      if (r.scorerName) {
        ctx.font = `800 ${Math.round(24 * u)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(10, 14, 28, 0.9)";
        ctx.lineWidth = 6 * u;
        ctx.lineJoin = "round";
        const who = `${r.ownGoal ? "Own goal" : "⚽"} ${r.scorerName}`;
        ctx.strokeText(who, x, y + 54 * u);
        ctx.fillText(who, x, y + 54 * u);
      }
      ctx.restore();
    }

    drawPuffCloud(ctx, a, pal) {
      const r = rng(a.seed);
      ctx.save();
      ctx.globalAlpha = pal.ambientAlpha * 0.7;
      ctx.translate(a.x, a.y);
      ctx.scale(a.s, a.s);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const px = -90 + i * 36 + r() * 10;
        const py = -Math.sin((i / 5) * Math.PI) * 24 + r() * 8;
        const pr = 22 + Math.sin((i / 5) * Math.PI) * 18 + r() * 8;
        ctx.moveTo(px + pr, py);
        ctx.arc(px, py, pr, 0, Math.PI * 2);
      }
      ctx.roundRect(-110, -6, 220, 26, 13);
      ctx.fillStyle = pal.cloudLit;
      ctx.fill();
      ctx.restore();
    }

    drawIsland(ctx, pal) {
      const { bank, box } = this.scenery;
      const grad = ctx.createLinearGradient(0, box.y0 - 80, 0, box.y1 + 80);
      grad.addColorStop(0, pal.cloudLit);
      grad.addColorStop(0.6, pal.cloudMid);
      grad.addColorStop(1, pal.cloudShade);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (const b of bank) {
        ctx.moveTo(b.x + b.r, b.y);
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      }
      ctx.fill();
      // Earthy underside so the pitch reads as a floating slab.
      ctx.fillStyle = pal.earth;
      ctx.beginPath();
      ctx.roundRect(box.x0, box.y0 + 14, box.x1 - box.x0, box.y1 - box.y0, 18);
      ctx.fill();
      ctx.fillStyle = pal.earthDark;
      ctx.fillRect(box.x0 + 10, box.y1 + 4, box.x1 - box.x0 - 20, 6);
    }

    drawPitch(ctx, pal, m) {
      const { box } = this.scenery;
      ctx.fillStyle = pal.apron;
      ctx.beginPath();
      ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 18);
      ctx.fill();
      const stripes = 14;
      const sw = (PITCH.R - PITCH.L) / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 ? pal.grassA : pal.grassB;
        ctx.fillRect(PITCH.L + i * sw, PITCH.T, sw + 0.5, PITCH.B - PITCH.T);
      }
      this.drawTeamSides(ctx, m);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 4;
      ctx.strokeRect(PITCH.L, PITCH.T, PITCH.R - PITCH.L, PITCH.B - PITCH.T);
      ctx.beginPath();
      ctx.moveTo(CX, PITCH.T);
      ctx.lineTo(CX, PITCH.B);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(CX, CY, 95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.line;
      ctx.beginPath();
      ctx.arc(CX, CY, 6, 0, Math.PI * 2);
      ctx.fill();
      for (const side of [-1, 1]) {
        const gx = side < 0 ? PITCH.L : PITCH.R;
        const depth = 210;
        const half = 220;
        ctx.strokeRect(side < 0 ? gx : gx - depth, CY - half, depth, half * 2);
        ctx.strokeRect(side < 0 ? gx : gx - 80, CY - 130, 80, 260);
        ctx.beginPath();
        ctx.arc(gx - side * 150, CY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx - side * 150, CY, 90, side < 0 ? -0.93 : Math.PI - 0.93, side < 0 ? 0.93 : Math.PI + 0.93);
        ctx.stroke();
      }
      // Team-colour stripe along each end line (outside the goal mouth): the team defending that end.
      for (const end of ["left", "right"]) {
        const x = end === "left" ? PITCH.L - 11 : PITCH.R + 3;
        const gh = Math.max(GOAL_HALF, M.mouthAt(m, end)); // a bricked-up goal's wall covers the rest
        ctx.fillStyle = TEAMS[M.teamAt(m, end)].color;
        ctx.fillRect(x, PITCH.T - 2, 8, CY - gh - PITCH.T - POST_R + 2);
        ctx.fillRect(x, CY + gh + POST_R, 8, PITCH.B - CY - gh - POST_R + 2);
      }
    }

    // Paint each half so nobody wonders which way to go: a team tint and big chevrons in the team's colour
    // pointing at the goal it attacks.
    drawTeamSides(ctx, m) {
      ctx.save();
      for (const end of ["left", "right"]) {
        const dir = end === "left" ? 1 : -1;
        const color = TEAMS[M.teamAt(m, end)].color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(end === "left" ? PITCH.L : CX, PITCH.T, CX - PITCH.L, PITCH.B - PITCH.T);

        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = color;
        ctx.lineWidth = 16;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const x0 = end === "left" ? PITCH.L + 330 : PITCH.R - 330;
        for (const y of [PITCH.T + 120, PITCH.B - 120]) {
          for (let i = 0; i < 3; i++) {
            const x = x0 + dir * i * 70;
            ctx.beginPath();
            ctx.moveTo(x - dir * 22, y - 40);
            ctx.lineTo(x + dir * 22, y);
            ctx.lineTo(x - dir * 22, y + 40);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    drawNets(ctx, pal, layer, m) {
      for (const side of [-1, 1]) {
        const lineX = side < 0 ? PITCH.L : PITCH.R;
        const backX = lineX + side * GOAL_DEPTH;
        const gh = M.mouthAt(m, side < 0 ? "left" : "right");
        const top = CY - gh;
        const bottom = CY + gh;
        const team = TEAMS[M.teamAt(m, side < 0 ? "left" : "right")];
        if (layer === "back") {
          ctx.fillStyle = pal.netBg;
          ctx.fillRect(Math.min(lineX, backX), top, GOAL_DEPTH, bottom - top);
          ctx.fillStyle = team.color;
          ctx.globalAlpha = 0.45;
          ctx.fillRect(Math.min(lineX, backX), top, GOAL_DEPTH, bottom - top);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = pal.net;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let y = top; y <= bottom; y += 14) {
            ctx.moveTo(lineX, y);
            ctx.lineTo(backX, y);
          }
          for (let x = 0; x <= GOAL_DEPTH; x += 13) {
            ctx.moveTo(lineX + side * x, top);
            ctx.lineTo(lineX + side * x, bottom);
          }
          ctx.stroke();
        } else {
          if (gh < GOAL_HALF - 0.5) {
            this.drawBrickWall(ctx, Math.min(lineX, backX), CY - GOAL_HALF - POST_R, GOAL_DEPTH, GOAL_HALF - gh + POST_R);
            this.drawBrickWall(ctx, Math.min(lineX, backX), bottom, GOAL_DEPTH, GOAL_HALF - gh + POST_R);
          }
          ctx.strokeStyle = team.color;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(lineX, top);
          ctx.lineTo(backX, top);
          ctx.lineTo(backX, bottom);
          ctx.lineTo(lineX, bottom);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          for (const py of [top, bottom]) {
            ctx.beginPath();
            ctx.arc(lineX, py, POST_R, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    drawShadow(ctx, pal, x, y, rx, ry, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pal.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    updateTrails(players, dt) {
      for (const p of players) {
        let t = this.trails.get(p.id);
        if (!t) this.trails.set(p.id, (t = []));
        if (p.dash > 0) t.push({ x: p.x, y: p.y, age: 0 });
        for (const s of t) s.age += dt;
        while (t.length && t[0].age > 0.25) t.shift();
      }
      for (const id of this.trails.keys()) if (!players.some((p) => p.id === id)) this.trails.delete(id);
    }

    drawTrails(ctx, players) {
      for (const p of players) {
        const team = TEAMS[p.team];
        for (const s of this.trails.get(p.id) || []) {
          ctx.globalAlpha = 0.35 * (1 - s.age / 0.25);
          ctx.fillStyle = team.color;
          const h = HALF * (p.scale || 1);
          ctx.fillRect(s.x - h, s.y - h, h * 2, h * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    faceOf(p) {
      const face = this.faces && this.faces.get(p.id);
      return face && face.img.complete && face.img.naturalWidth ? face.img : null;
    }

    drawPlayer(ctx, p) {
      const team = TEAMS[p.team];
      const img = this.faceOf(p);
      if (img) {
        this.drawFacePlayer(ctx, p, team, img);
        return;
      }
      const lift = 9;
      ctx.save();
      ctx.globalAlpha = p.connected ? 1 : 0.4;
      // Side face (gives the block its height), then the lit top face.
      ctx.fillStyle = team.dark;
      ctx.beginPath();
      ctx.roundRect(p.x - HALF, p.y - HALF + lift, HALF * 2, HALF * 2, 7);
      ctx.fill();
      const top = ctx.createLinearGradient(0, p.y - HALF, 0, p.y + HALF);
      top.addColorStop(0, "#ffffff");
      top.addColorStop(0.12, team.color);
      top.addColorStop(1, team.color);
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.roundRect(p.x - HALF, p.y - HALF, HALF * 2, HALF * 2, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();

      this.drawEyes(ctx, p);
      if (p.cooldown <= 0 && p.connected) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(p.x - HALF - 4, p.y - HALF - 4, HALF * 2 + 8, HALF * 2 + 8 + lift, 10);
        ctx.stroke();
      }
      ctx.restore();
    }

    // A face player is just a team-colour frame (bright when Kick is ready) around their photo, cut to the
    // face-guide oval and as big as the frame allows; inside the frame is see-through.
    drawFacePlayer(ctx, p, team, img) {
      const line = 3.5;
      const top = p.y - FRAME.top;
      const height = FRAME.top + FRAME.bottom;
      ctx.save();
      ctx.globalAlpha = p.connected ? 1 : 0.4;
      const ry = height / 2 - line;
      const side = ry / FACE_OVAL.ry;
      const cy = top + height / 2;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(p.x, cy, side * FACE_OVAL.rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, p.x - side / 2, cy - side / 2, side, side);
      ctx.restore();
      if (p.cooldown > 0 || !p.connected) ctx.globalAlpha *= 0.45;
      ctx.strokeStyle = team.color;
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.roundRect(p.x - FRAME.half, top, FRAME.half * 2, height, 10);
      ctx.stroke();
      ctx.restore();
    }

    // A chunky five-point star with eyes that bobs, glows, and blinks before it fades away.
    drawStar(ctx, s) {
      const left = STAR_LIFE - s.age;
      if (left < 3 && Math.floor(left * 6) % 2) return;
      const bob = Math.sin(this.t * 5) * 4;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.rotate(Math.sin(this.t * 3) * 0.15);
      ctx.shadowColor = "rgba(253, 224, 71, 0.95)";
      ctx.shadowBlur = 24;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? STAR_R * 0.5 : STAR_R * 1.15;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -STAR_R, 0, STAR_R);
      g.addColorStop(0, "#fef08a");
      g.addColorStop(1, "#f59e0b");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#b45309";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fillStyle = "#111827";
      for (const ex of [-5, 5]) {
        ctx.beginPath();
        ctx.ellipse(ex, -1, 2.4, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // A red-capped, white-spotted mushroom with a face; it pops up from the grass and blinks before withering.
    drawShroom(ctx, pal, s) {
      const left = SHROOM_LIFE - s.age;
      if (left < 3 && Math.floor(left * 6) % 2) return;
      const grow = Math.min(1, s.age / 0.5);
      const pop = grow < 1 ? grow * (1 + 0.3 * Math.sin(grow * Math.PI)) : 1 + Math.sin(this.t * 4) * 0.03;
      const R = SHROOM_R;
      this.drawShadow(ctx, pal, s.x, s.y + R * 0.75, R * 0.9 * grow, 5 * grow, 0.8);
      ctx.save();
      ctx.translate(s.x, s.y + R * 0.75);
      ctx.scale(pop, pop);
      ctx.translate(0, -R * 0.75);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#7f1d1d";
      // Stem with eyes.
      ctx.fillStyle = "#fef3c7";
      ctx.beginPath();
      ctx.roundRect(-R * 0.5, -R * 0.05, R, R * 0.8, R * 0.25);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111827";
      for (const ex of [-R * 0.18, R * 0.18]) {
        ctx.beginPath();
        ctx.ellipse(ex, R * 0.32, 2, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Cap.
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(-R * 1.05, R * 0.05);
      ctx.bezierCurveTo(-R * 1.15, -R * 1.25, R * 1.15, -R * 1.25, R * 1.05, R * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      for (const [x, y, r] of [[0, -R * 0.62, R * 0.32], [-R * 0.82, -R * 0.2, R * 0.3], [R * 0.82, -R * 0.2, R * 0.3]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.restore();
    }

    // A flower with fiery layered petals and a face on a leafy stem; sways, blinks before it wilts.
    drawFlower(ctx, pal, f) {
      const left = FLOWER_LIFE - f.age;
      if (left < 3 && Math.floor(left * 6) % 2) return;
      const grow = Math.min(1, f.age / 0.5);
      const pop = grow < 1 ? grow * (1 + 0.3 * Math.sin(grow * Math.PI)) : 1;
      const R = FLOWER_R;
      this.drawShadow(ctx, pal, f.x, f.y + R * 1.1, R * 0.7 * grow, 4 * grow, 0.8);
      ctx.save();
      ctx.translate(f.x, f.y + R * 1.1);
      ctx.scale(pop, pop);
      ctx.rotate(Math.sin(this.t * 2.5) * 0.08);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#14532d";
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(-2, -R * 1.1, 4, R * 1.1);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * R * 0.45, -R * 0.3, R * 0.45, R * 0.18, side * -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.translate(0, -R * 1.25);
      ctx.strokeStyle = "#9a3412";
      for (const [rad, color] of [[R * 0.95, "#ef4444"], [R * 0.72, "#f97316"], [R * 0.5, "#fde047"]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * 1.15, rad * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "#fffbeb";
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.32, R * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111827";
      for (const ex of [-R * 0.12, R * 0.12]) {
        ctx.beginPath();
        ctx.ellipse(ex, 0, 1.6, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Rows of red bricks with pale mortar filling a rectangle (the bricked-up part of a shrunken goal).
    drawBrickWall(ctx, x, y, w, h) {
      if (h <= 0) return;
      const bw = 20;
      const bh = 11;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = "#fecaca";
      ctx.fillRect(x, y, w, h);
      for (let row = 0, by = y + h; by > y - bh; row++, by -= bh) {
        for (let bx = x - (row % 2 ? bw / 2 : 0); bx < x + w; bx += bw) {
          ctx.fillStyle = (row + Math.round(bx / bw)) % 3 ? "#b91c1c" : "#991b1b";
          ctx.fillRect(bx + 1, by - bh + 1, bw - 2, bh - 2);
        }
      }
      ctx.restore();
      ctx.strokeStyle = "#7f1d1d";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }

    // A chunky red brick with a cheeky face and a golden shimmer; bobs about, blinks before it crumbles away.
    drawBrick(ctx, pal, b) {
      const left = BRICK_LIFE - b.age;
      if (left < 3 && Math.floor(left * 6) % 2) return;
      const grow = Math.min(1, b.age / 0.5);
      const pop = grow < 1 ? grow * (1 + 0.3 * Math.sin(grow * Math.PI)) : 1;
      const R = BRICK_R;
      const bob = Math.sin(this.t * 3) * 4;
      this.drawShadow(ctx, pal, b.x, b.y + R * 0.9, R * 1.1 * grow, 5 * grow, 0.8);
      ctx.save();
      ctx.translate(b.x, b.y - 6 + bob);
      ctx.scale(pop * 1.25, pop * 1.25); // a size up so it reads across the room
      ctx.rotate(Math.sin(this.t * 2) * 0.1);
      const glow = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 2);
      glow.addColorStop(0, "rgba(253, 224, 71, 0.55)");
      glow.addColorStop(1, "rgba(253, 224, 71, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R * 2, 0, Math.PI * 2);
      ctx.fill();
      const w = R * 2.1;
      const h = R * 1.25;
      ctx.fillStyle = "#b91c1c";
      ctx.strokeStyle = "#450a0a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ef4444"; // top face highlight
      ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 4);
      ctx.fillStyle = "#7f1d1d"; // the two holes on the side
      for (const hx of [-w * 0.27, w * 0.27]) {
        ctx.beginPath();
        ctx.ellipse(hx, h * 0.22, 3.5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#111827";
      for (const ex of [-R * 0.22, R * 0.22]) {
        ctx.beginPath();
        ctx.ellipse(ex, -h * 0.05, 2, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, h * 0.12, 4, 0.2, Math.PI - 0.2);
      ctx.stroke();
      ctx.restore();
    }

    // A strutting turkey: fanned tail feathers, flapping wings, bobbing head with a red wattle. It faces the way it's
    // going, flaps hard when it hops or bolts, and blinks before it flies off.
    drawTurkey(ctx, pal, tk) {
      const left = M.TURKEY_LIFE - tk.age;
      if (left < 3 && Math.floor(left * 6) % 2) return;
      const t = this.t;
      const speed = Math.hypot(tk.vx, tk.vy);
      const panic = tk.flap > 0 || speed > M.TURKEY_SPEED + 40;
      const flap = Math.sin(t * (panic ? 34 : 9)) * (panic ? 0.9 : 0.25);
      const dir = tk.vx < -5 ? -1 : 1;
      const R = M.TURKEY_R;
      const hopY = tk.flap > 0 ? -Math.sin((tk.flap / 0.35) * Math.PI) * 14 : 0;
      const step = speed > 20 ? Math.sin(t * 22) : 0;
      this.drawShadow(ctx, pal, tk.x, tk.y + R * 1.25, R * 1.2, 7, tk.flap > 0 ? 0.5 : 0.9);
      ctx.save();
      ctx.translate(tk.x, tk.y + hopY);
      ctx.scale(dir * 1.3, 1.3); // drawn a size up so it reads across the room
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#451a03";
      // Legs.
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 3;
      for (const [lx, ph] of [[-4, 1], [5, -1]]) {
        ctx.beginPath();
        ctx.moveTo(lx, R * 0.45);
        ctx.lineTo(lx + step * 4 * ph, R * 0.95);
        ctx.stroke();
      }
      // Tail fan behind the body.
      const fan = [["#78350f", 1.35], ["#b45309", 1.15], ["#c2410c", 0.95], ["#fef3c7", 0.72]];
      for (const [color, len] of fan) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 - 1.15 + (i * 2.3) / 6 + Math.sin(t * 3 + i) * 0.03;
          ctx.moveTo(-R * 0.35, -R * 0.1);
          ctx.ellipse(-R * 0.35 + Math.cos(a) * R * len * 0.55, -R * 0.1 + Math.sin(a) * R * len * 0.55, R * 0.22, R * len * 0.5, a + Math.PI / 2, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      // Body.
      const body = ctx.createRadialGradient(-3, -4, 2, 0, 0, R * 0.8);
      body.addColorStop(0, "#a16207");
      body.addColorStop(1, "#713f12");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, R * 0.12, R * 0.62, R * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#451a03";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Wings, flapping.
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * R * 0.28, R * 0.02);
        ctx.rotate(side * (0.35 + flap));
        ctx.fillStyle = side > 0 ? "#92400e" : "#78350f";
        ctx.beginPath();
        ctx.ellipse(side * R * 0.32, 0, R * 0.42, R * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      // Head and neck, pecking/bobbing.
      const bob = tk.pause > 0 ? Math.max(0, Math.sin(t * 14)) * 8 : Math.sin(t * 11) * 2;
      const hx = R * 0.52;
      const hy = -R * 0.38 + bob;
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(R * 0.3, -R * 0.05);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = "#e7c9a9";
      ctx.beginPath();
      ctx.arc(hx, hy, R * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f59e0b"; // beak
      ctx.beginPath();
      ctx.moveTo(hx + R * 0.18, hy - 2);
      ctx.lineTo(hx + R * 0.38, hy + 1);
      ctx.lineTo(hx + R * 0.18, hy + 4);
      ctx.fill();
      ctx.fillStyle = "#dc2626"; // wattle
      ctx.beginPath();
      ctx.ellipse(hx + R * 0.16, hy + R * 0.2, 2.6, 5.5 + Math.sin(t * 9) * 1, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(hx + 2, hy - 2, panic ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Food coma: drowsy Zzz drifting up from a stuffed player.
    drawComa(ctx, p) {
      const s = p.scale || 1;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#c7d2fe";
      ctx.strokeStyle = "#312e81";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      // Each z grows as it drifts up and to the side, then fades; three in flight at a time.
      for (let i = 0; i < 3; i++) {
        const k = (this.t * 0.6 + i / 3) % 1;
        ctx.globalAlpha = (p.connected ? 1 : 0.4) * Math.min(1, Math.sin(k * Math.PI) * 1.6);
        ctx.font = `900 ${Math.round((14 + k * 16) * s)}px Inter, system-ui, -apple-system, sans-serif`;
        const x = p.x + (HALF * 0.4 + k * 30) * s;
        const y = p.y - (HALF + 14 + k * 46) * s;
        ctx.strokeText("Z", x, y);
        ctx.fillText("Z", x, y);
      }
      ctx.restore();
    }

    // Flickering fiery glow behind a player with flower power.
    drawFlowerAura(ctx, p) {
      if (p.flower < 2 && Math.floor(p.flower * 8) % 2) return;
      const cy = p.y + (FRAME.bottom - FRAME.top) / 2;
      const flicker = 1 + Math.sin(this.t * 13) * 0.06 + Math.sin(this.t * 7.3) * 0.04;
      const g = ctx.createRadialGradient(p.x, cy, FRAME.half * 0.6, p.x, cy, FRAME.bottom * 1.7 * flicker);
      g.addColorStop(0, "rgba(253, 186, 116, 0.9)");
      g.addColorStop(0.5, "rgba(249, 115, 22, 0.45)");
      g.addColorStop(1, "rgba(239, 68, 68, 0)");
      ctx.save();
      ctx.globalAlpha = p.connected ? 1 : 0.4;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, cy, FRAME.bottom * 1.7 * flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // "2×" (or whatever flower goals are worth) badge on the top-right corner of a player with flower power.
    drawFlowerBadge(ctx, p, points) {
      if (p.flower < 2 && Math.floor(p.flower * 8) % 2) return;
      const bx = p.x + FRAME.half;
      const by = p.y - FRAME.top;
      ctx.save();
      ctx.fillStyle = "#f97316";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx - 16, by - 10, 32, 20, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 13px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${points}×`, bx, by + 1);
      ctx.restore();
    }

    // A little brick on the top-left corner of the player who's bricked up their goal.
    drawBrickBadge(ctx, p) {
      if (p.brick < 2 && Math.floor(p.brick * 8) % 2) return;
      const bx = p.x - FRAME.half;
      const by = p.y - FRAME.top;
      ctx.save();
      ctx.fillStyle = "#b91c1c";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx - 14, by - 9, 28, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#fecaca";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - 12, by);
      ctx.lineTo(bx + 12, by);
      ctx.moveTo(bx, by - 8);
      ctx.lineTo(bx, by);
      ctx.moveTo(bx - 6, by);
      ctx.lineTo(bx - 6, by + 8);
      ctx.moveTo(bx + 6, by);
      ctx.lineTo(bx + 6, by + 8);
      ctx.stroke();
      ctx.restore();
    }

    // Rainbow, glowing outline plus orbiting sparkles while a player has star power (blinks as it runs out).
    drawStarAura(ctx, p) {
      if (p.star < 2 && Math.floor(p.star * 8) % 2) return;
      const hue = (this.t * 540) % 360;
      ctx.save();
      ctx.globalAlpha = p.connected ? 1 : 0.4;
      ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
      ctx.shadowColor = `hsl(${(hue + 60) % 360}, 100%, 65%)`;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.roundRect(p.x - FRAME.half, p.y - FRAME.top, FRAME.half * 2, FRAME.top + FRAME.bottom, 10);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const cy = p.y + (FRAME.bottom - FRAME.top) / 2;
      for (let i = 0; i < 4; i++) {
        const a = this.t * 4 + (i * Math.PI) / 2;
        ctx.fillStyle = `hsl(${(hue + i * 90) % 360}, 100%, 70%)`;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * (FRAME.half + 9), cy + Math.sin(a) * (FRAME.top + 9), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Number, then two eyes looking where the player is heading.
    drawEyes(ctx, p) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "800 20px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(p.number), p.x, p.y + 6);
      const fx = Math.cos(p.facing);
      const fy = Math.sin(p.facing);
      const ex = p.x + fx * 9;
      const ey = p.y - 8 + fy * 5;
      for (const side of [-1, 1]) {
        const px = ex - fy * 7 * side;
        const py = ey + fx * 4 * side;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.arc(px + fx * 1.8, py + fy * 1.8, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawBall(ctx, b) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, BALL_R);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#d6dde8");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.clip();
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(Math.cos(b.spin) * 3, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5;
        const x = Math.cos(a) * 11 + Math.cos(b.spin) * 3;
        const y = Math.sin(a) * 11;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawFx(ctx, dt) {
      for (const f of this.fx) {
        f.age += dt;
        const k = f.age / f.life;
        if (f.kind === "ring") {
          ctx.globalAlpha = Math.max(0, 1 - k);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, BALL_R + k * 50, 0, Math.PI * 2);
          ctx.stroke();
        } else if (f.kind === "emoji") {
          f.vy *= Math.exp(-0.6 * dt);
          f.x += (f.vx + Math.sin(f.age * 5) * 30) * dt;
          f.y += f.vy * dt;
          ctx.globalAlpha = Math.max(0, Math.min(1, (1 - k) * 2.5));
          ctx.font = `${Math.round(f.size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(f.emoji, f.x, f.y);
        } else {
          f.vy += 500 * dt;
          f.vx *= Math.exp(-1.2 * dt);
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.rot += 6 * dt;
          ctx.globalAlpha = Math.max(0, 1 - k);
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.rot);
          ctx.fillStyle = f.color;
          ctx.fillRect(-f.size / 2, -f.size / 4, f.size, f.size / 2);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      this.fx = this.fx.filter((f) => f.age < f.life);
    }

    drawFloodlights(ctx, pal) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [x, y] of [[PITCH.L, PITCH.T], [PITCH.R, PITCH.T], [PITCH.L, PITCH.B], [PITCH.R, PITCH.B]]) {
        const g = ctx.createRadialGradient(x, y, 10, x, y, 520);
        g.addColorStop(0, `rgba(255, 245, 220, ${0.22 * pal.flood})`);
        g.addColorStop(1, "rgba(255, 245, 220, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - 520, y - 520, 1040, 1040);
      }
      ctx.restore();
    }

    drawTag(ctx, pal, p) {
      const label = p.connected ? p.name : `${p.name} (away)`;
      ctx.save();
      ctx.globalAlpha = p.connected ? 0.95 : 0.55;
      ctx.font = "600 15px Inter, system-ui, -apple-system, sans-serif";
      const w = ctx.measureText(label).width + 18;
      const x = p.x - w / 2;
      const y = p.y - (HALF + 4) * (p.scale || 1) - 26;
      ctx.fillStyle = pal.tagBg;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = pal.tagInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, p.x, y + 12);
      ctx.restore();
    }
  }

  Renderer.REPLAY_TIME = REPLAY.time;
  U.Renderer = Renderer;
  U.PALETTES = PALETTES;
})(typeof window !== "undefined" ? window : globalThis);
