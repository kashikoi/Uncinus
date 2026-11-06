/* Uncinus — sound effects for the host screen. Everything is synthesised with WebAudio (no audio files); the
   countdown uses the browser's speech voice. Browsers keep audio locked until the first click/key on the page. */
(function (root) {
  "use strict";

  const SOUND_KEY = "uncinus_sound";
  const OOF_GAP = 0.45; // seconds before the same player can oof again
  const STAR_STEP = 0.075; // seconds per 16th note of the star theme

  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = loadEnabled();
  let starLoop = null;
  const lastOof = new Map();
  const listeners = new Set();

  function loadEnabled() {
    try {
      return root.localStorage.getItem(SOUND_KEY) !== "0";
    } catch {
      return true;
    }
  }

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    ctx.onstatechange = notify;
    return ctx;
  }

  const notify = () => listeners.forEach((fn) => fn());
  const ready = () => enabled && ensure() && ctx.state === "running";
  const locked = () => enabled && (!ctx || ctx.state !== "running");

  // Call from a user gesture: resumes audio and primes speech (both are blocked until the page is interacted with).
  function unlock() {
    if (!enabled || !ensure()) return;
    if (ctx.state !== "running") ctx.resume().then(notify, notify);
    if (root.speechSynthesis && !unlock.spoke) {
      unlock.spoke = true;
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      root.speechSynthesis.speak(u);
    }
  }

  function setEnabled(on) {
    enabled = on;
    try {
      root.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {
      // Not persisted; still applies for this session.
    }
    if (on) unlock();
    else {
      stopStar();
      if (root.speechSynthesis) root.speechSynthesis.cancel();
    }
    notify();
  }

  // ---------- Building blocks ----------
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);

  function out(pan = 0, gain = 1) {
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(master);
    } else g.connect(master);
    return g;
  }

  // Attack/decay envelope on a fresh gain node.
  function env(dest, t, peak, attack, hold, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest);
    return g;
  }

  function tone(dest, { type = "square", freq, to, t, dur, gain = 0.2, attack = 0.005, vibrato = 0, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.detune.value = detune;
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o.connect(env(dest, t, gain, attack, Math.max(0, dur - attack - 0.04), 0.04));
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  function filter(type, freq, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // ---------- Effects ----------

  // Mushroom: a wobbly, stepping power-up climb.
  function grow() {
    if (!ready()) return;
    const t0 = ctx.currentTime + 0.02;
    const dest = out(0, 0.9);
    const base = [55, 59, 62, 67];
    for (let i = 0; i < 14; i++) {
      const n = base[i % 4] + Math.floor(i / 4) * 5 + (i % 2 ? 7 : 0);
      tone(dest, { type: "square", freq: midi(n), t: t0 + i * 0.065, dur: 0.07, gain: 0.13 });
      tone(dest, { type: "triangle", freq: midi(n - 12), t: t0 + i * 0.065, dur: 0.07, gain: 0.12 });
    }
    tone(dest, { type: "square", freq: midi(79), t: t0 + 14 * 0.065, dur: 0.35, gain: 0.12, vibrato: 12 });
  }

  // Star: a hyper chiptune loop that plays for as long as the star lasts.
  const STAR_CHORDS = [0, 0, 5, 7]; // I I IV V, two bars each
  const STAR_LEAD = [12, 16, 19, 24, 19, 16, 12, 16, 14, 17, 21, 26, 21, 17, 14, 19];
  function starOn(secs) {
    if (!ready()) return;
    stopStar();
    const dest = out(0, 0.75);
    const end = ctx.currentTime + secs;
    const loop = { dest, next: ctx.currentTime + 0.03, step: 0, end, timer: null };
    const schedule = () => {
      while (loop.next < ctx.currentTime + 0.2 && loop.next < loop.end) {
        const s = loop.step;
        const key = 60 + STAR_CHORDS[Math.floor(s / 32) % 4];
        const lead = key + STAR_LEAD[s % 16] - 12 + (s % 32 >= 16 ? 2 : 0);
        tone(dest, { type: "square", freq: midi(lead), t: loop.next, dur: STAR_STEP * 0.9, gain: 0.09 });
        if (s % 2 === 0) tone(dest, { type: "triangle", freq: midi(key - 24 + (s % 4 === 2 ? 12 : 0)), t: loop.next, dur: STAR_STEP * 1.6, gain: 0.22 });
        if (s % 4 === 2) {
          const hat = noiseSrc(loop.next, 0.04);
          hat.connect(filter("highpass", 7000)).connect(env(dest, loop.next, 0.12, 0.002, 0, 0.04));
        }
        loop.next += STAR_STEP;
        loop.step++;
      }
      if (loop.next >= loop.end) stopStar();
    };
    loop.timer = setInterval(schedule, 50);
    schedule();
    starLoop = loop;
  }

  function stopStar() {
    if (!starLoop) return;
    clearInterval(starLoop.timer);
    const g = starLoop.dest.gain;
    g.setTargetAtTime(0, ctx.currentTime, 0.05);
    starLoop = null;
  }

  // Flower: a big brassy "you're on a roll" fanfare with a cash-register sparkle.
  function fanfare() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    const dest = out(0, 0.8);
    const brass = ctx.createBiquadFilter();
    brass.type = "lowpass";
    brass.frequency.value = 2600;
    brass.connect(dest);
    const notes = [
      [0, 0.09, 67], [0.11, 0.09, 67], [0.22, 0.09, 67], [0.33, 0.3, 72],
      [0.66, 0.12, 71], [0.8, 0.12, 72], [0.94, 0.7, 76],
    ];
    for (const [at, dur, n] of notes) {
      for (const d of [-8, 8]) tone(brass, { type: "sawtooth", freq: midi(n), t: t + at, dur, gain: 0.08, attack: 0.02, detune: d, vibrato: dur > 0.5 ? 6 : 0 });
      tone(brass, { type: "sawtooth", freq: midi(n - 12), t: t + at, dur, gain: 0.06, attack: 0.02 });
    }
    for (const n of [64, 67]) tone(brass, { type: "sawtooth", freq: midi(n), t: t + 0.94, dur: 0.7, gain: 0.05, attack: 0.03 });
    [88, 91, 96, 100].forEach((n, i) => tone(dest, { type: "triangle", freq: midi(n), t: t + 1.0 + i * 0.06, dur: 0.25, gain: 0.08 }));
  }

  // Bump: a vocal "oof!" — a falling buzzy "oo" through vowel formants, then a breathy "f".
  function oof(id, pan, seed) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - (lastOof.get(id) || -1) < OOF_GAP) return;
    lastOof.set(id, now);
    const t = now + Math.random() * 0.07;
    const f0 = 120 + (seed % 9) * 22 + Math.random() * 15;
    const shift = 0.9 + ((seed >> 3) % 5) * 0.06;
    const dest = out(pan, 1.1);
    const voice = ctx.createOscillator();
    voice.type = "sawtooth";
    voice.frequency.setValueAtTime(f0 * 1.15, t);
    voice.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + 0.22);
    const vEnv = env(dest, t, 0.5, 0.012, 0.1, 0.1);
    for (const [from, to, q, g] of [[520, 330, 8, 1], [1000, 780, 10, 0.5], [2400, 2300, 12, 0.12]]) {
      const f = filter("bandpass", from * shift, q);
      f.frequency.exponentialRampToValueAtTime(to * shift, t + 0.15);
      const fg = ctx.createGain();
      fg.gain.value = g;
      voice.connect(f).connect(fg).connect(vEnv);
    }
    voice.start(t);
    voice.stop(t + 0.3);
    const fric = noiseSrc(t + 0.17, 0.16);
    fric.connect(filter("bandpass", 4200, 0.8)).connect(env(dest, t + 0.17, 0.12, 0.02, 0.04, 0.1));
  }

  // Goal: the crowd goes wild — a swelling roar, cheering voices, applause and a couple of whistles.
  function crowd() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    const dest = out(0, 1);
    const roar = noiseSrc(t, 4.2);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.55, t + 0.35);
    rg.gain.setValueAtTime(0.55, t + 1.6);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    roar.connect(filter("bandpass", 850, 0.5)).connect(filter("lowpass", 2800)).connect(rg).connect(dest);
    for (let i = 0; i < 18; i++) {
      const at = t + Math.random() * 0.7;
      const dur = 0.7 + Math.random() * 1.2;
      const f0 = 170 + Math.random() * 260;
      const v = ctx.createOscillator();
      v.type = "sawtooth";
      v.frequency.setValueAtTime(f0 * 0.8, at);
      v.frequency.exponentialRampToValueAtTime(f0 * 1.35, at + dur * 0.35);
      v.frequency.exponentialRampToValueAtTime(f0, at + dur);
      const ve = env(dest, at, 0.07 + Math.random() * 0.05, 0.08, dur * 0.5, dur * 0.4);
      const ah = Math.random() < 0.5;
      for (const [f, q] of ah ? [[750, 6], [1200, 8]] : [[380, 6], [900, 8]]) v.connect(filter("bandpass", f, q)).connect(ve);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.random() * 1.6 - 0.8;
        ve.disconnect();
        ve.connect(p).connect(dest);
      }
      v.start(at);
      v.stop(at + dur + 0.1);
    }
    for (let i = 0; i < 70; i++) {
      const at = t + 0.2 + Math.random() * 3;
      const clap = noiseSrc(at, 0.03);
      clap.connect(filter("bandpass", 1100 + Math.random() * 1200, 1.2)).connect(env(dest, at, 0.12 + Math.random() * 0.12, 0.002, 0, 0.03));
    }
    for (const at of [0.4, 1.3]) {
      tone(dest, { type: "sine", freq: 1700, to: 2600, t: t + at, dur: 0.25, gain: 0.05 });
      tone(dest, { type: "sine", freq: 2600, to: 1500, t: t + at + 0.28, dur: 0.4, gain: 0.05 });
    }
  }

  // Countdown: the browser says "10!", "9!"… with a tick under each number.
  function count(n) {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    tone(out(0, 0.6), { type: "square", freq: n <= 3 ? 1320 : 880, t, dur: 0.06, gain: 0.12 });
    const speech = root.speechSynthesis;
    if (!speech) return;
    speech.cancel();
    const u = new SpeechSynthesisUtterance(`${n}!`);
    const voices = speech.getVoices();
    u.voice = voices.find((v) => /^en/i.test(v.lang) && /Samantha|Daniel|Google/i.test(v.name)) || voices.find((v) => /^en/i.test(v.lang)) || null;
    u.rate = 1.25;
    u.pitch = 1.1;
    u.volume = 1;
    speech.speak(u);
  }

  // Time up: a big stadium air horn.
  function airHorn() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    const dest = out(0, 0.7);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(3 * x);
    }
    shaper.curve = curve;
    const tonePath = filter("lowpass", 2400, 0.7);
    shaper.connect(tonePath).connect(dest);
    const blasts = [[0, 0.32], [0.42, 1.3]];
    for (const [at, dur] of blasts) {
      for (const [f, d] of [[233, -6], [233, 7], [349, 0], [466, 4]]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f * 0.94, t + at);
        o.frequency.exponentialRampToValueAtTime(f, t + at + 0.06);
        o.detune.value = d;
        o.connect(env(shaper, t + at, 0.18, 0.03, dur - 0.1, 0.12));
        o.start(t + at);
        o.stop(t + at + dur + 0.1);
      }
    }
  }

  // Kick: an airy whoosh that sweeps up and away.
  function whoosh(pan) {
    if (!ready()) return;
    const t = ctx.currentTime + 0.005;
    const src = noiseSrc(t, 0.4);
    const bp = filter("bandpass", 350, 1.4);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.14);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.38);
    src.connect(bp).connect(env(out(pan, 1), t, 0.55, 0.08, 0.04, 0.24));
  }

  root.Uncinus = root.Uncinus || {};
  root.Uncinus.sound = {
    get enabled() {
      return enabled;
    },
    locked,
    unlock,
    setEnabled,
    onChange: (fn) => listeners.add(fn),
    grow,
    starOn,
    starOff: stopStar,
    fanfare,
    oof,
    crowd,
    count,
    airHorn,
    whoosh,
  };
})(window);
