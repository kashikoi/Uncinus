/* Uncinus — shared helpers: version, relay URL, ids, theme (atmosphere). */
(function (root) {
  "use strict";

  const APP_VERSION = "2026.11.18.1";
  const DEFAULT_RELAY = "wss://uncinus-relay.nimbus-sync.workers.dev";
  const RELAY_KEY = "uncinus_relay";
  const THEME_KEY = "uncinus_theme";
  const ACTIVE_THEME_KEY = "uncinus_active_theme";
  const THEMES = ["day", "twilight", "night"];
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  // Room codes go up on an office TV: never show one that contains any of these (the alphabet has no I or O, which
  // already rules out most). Common letter-swaps (U↔V, K↔C, X for CK) are listed too.
  const BLOCKED_ROOM_WORDS = [
    "ANAL", "ANUS", "ARSE", "ASS", "BUTT", "CRAP", "CUM", "CUNT", "DAMN", "DYKE", "FAG", "FAP", "FCK", "FFS", "FUC", "FUK",
    "FUQ", "FVCK", "FUX", "GAY", "HELL", "HUMP", "JEW", "JERK", "KKK", "KUNT", "KYS", "NUDE", "PEE", "PERV", "PMS", "PUKE",
    "PUSY", "PUTA", "PUTZ", "RAPE", "RAPY", "SEX", "SHAG", "SHT", "SLUT", "SMUT", "STFU", "SUCK", "SUX", "TURD", "TWAT",
    "VAG", "WANK", "WTF", "XXX", "CVNT", "SLVT", "DMN", "FKN", "FML", "NSFW", "PRN", "PRNS", "THC", "METH",
    "PUSS", "PVSS", "CUCK", "KUM", "SHAT", "SKANK", "SKNK", "TWT", "TARD", "SPAZ", "SPAS", "JAP", "GYP", "NGGR", "NGGA",
    "NGR", "NGA", "FUGLY", "SLAG",
  ];

  function isRelayUrl(value) {
    return /^wss?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(String(value || ""));
  }

  // ?relay=ws://host:8787 points this browser at a local relay (remembered); ?relay=default resets.
  function relayUrl(search) {
    const params = new URLSearchParams(search == null ? root.location.search : search);
    const fromQuery = params.get("relay");
    try {
      if (fromQuery === "default") localStorage.removeItem(RELAY_KEY);
      else if (isRelayUrl(fromQuery)) localStorage.setItem(RELAY_KEY, fromQuery.replace(/\/+$/, ""));
      const stored = localStorage.getItem(RELAY_KEY);
      if (isRelayUrl(stored)) return stored;
    } catch {
      if (isRelayUrl(fromQuery)) return fromQuery.replace(/\/+$/, "");
    }
    return DEFAULT_RELAY;
  }

  function setRelayUrl(value) {
    if (!value || value === DEFAULT_RELAY) localStorage.removeItem(RELAY_KEY);
    else if (isRelayUrl(value)) localStorage.setItem(RELAY_KEY, value.replace(/\/+$/, ""));
    else throw new Error("Relay URL must start with ws:// or wss://");
  }

  function randomId(len = 10) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  }

  function roomCode() {
    const bytes = new Uint8Array(4);
    for (;;) {
      crypto.getRandomValues(bytes);
      const code = Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
      if (isCleanRoomCode(code)) return code;
    }
  }

  function isCleanRoomCode(code) {
    const s = String(code || "").toUpperCase();
    return !BLOCKED_ROOM_WORDS.some((w) => s.includes(w));
  }

  function isRoomCode(value) {
    return /^[A-HJ-NP-Z]{4}$/.test(String(value || ""));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function getThemePref() {
    const pref = localStorage.getItem(THEME_KEY);
    return THEMES.includes(pref) || pref === "random" ? pref : "day";
  }

  function activeTheme() {
    const pref = getThemePref();
    if (pref !== "random") return pref;
    let mode = sessionStorage.getItem(ACTIVE_THEME_KEY);
    if (!THEMES.includes(mode)) {
      mode = THEMES[Math.floor(Math.random() * THEMES.length)];
      sessionStorage.setItem(ACTIVE_THEME_KEY, mode);
    }
    return mode;
  }

  function setThemePref(pref) {
    localStorage.setItem(THEME_KEY, pref);
    sessionStorage.removeItem(ACTIVE_THEME_KEY);
    return applyTheme();
  }

  function applyTheme() {
    const mode = activeTheme();
    document.documentElement.classList.remove("day", "twilight", "night");
    document.documentElement.classList.add(mode);
    return mode;
  }

  const api = {
    APP_VERSION,
    DEFAULT_RELAY,
    THEMES,
    isRelayUrl,
    relayUrl,
    setRelayUrl,
    randomId,
    roomCode,
    isRoomCode,
    isCleanRoomCode,
    escapeHtml,
    getThemePref,
    activeTheme,
    setThemePref,
    applyTheme,
  };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.util = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
