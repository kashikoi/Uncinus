const test = require("node:test");
const assert = require("node:assert/strict");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const util = require("../js/util.js");

test("room codes avoid I and O and validate", () => {
  for (let i = 0; i < 200; i++) {
    const code = util.roomCode();
    assert.ok(util.isRoomCode(code), code);
    assert.doesNotMatch(code, /[IO]/);
  }
  assert.ok(!util.isRoomCode("ABIO"));
  assert.ok(!util.isRoomCode("abcd"));
});

test("room codes never spell a rude word", () => {
  for (const bad of ["FUCK", "CUNT", "SLUT", "ASSE", "WANK", "RAPE", "QSEX"]) assert.ok(!util.isCleanRoomCode(bad), bad);
  for (const ok of ["KXRM", "BBWQ", "PCGG"]) assert.ok(util.isCleanRoomCode(ok), ok);
  // When the dice land on a rude one, it rolls again.
  const rolls = [[5, 18, 2, 9], [9, 21, 15, 11]]; // FUCK, then KXRM
  const real = crypto.getRandomValues;
  crypto.getRandomValues = (bytes) => (bytes.set(rolls.shift()), bytes);
  try {
    assert.equal(util.roomCode(), "KXRM");
  } finally {
    crypto.getRandomValues = real;
  }
});

test("relay url: default, query override is remembered, reset", () => {
  store.clear();
  assert.equal(util.relayUrl(""), util.DEFAULT_RELAY);
  assert.equal(util.relayUrl("?relay=ws://192.168.1.5:8787/"), "ws://192.168.1.5:8787");
  assert.equal(util.relayUrl(""), "ws://192.168.1.5:8787");
  assert.equal(util.relayUrl("?relay=javascript:alert(1)"), "ws://192.168.1.5:8787");
  assert.equal(util.relayUrl("?relay=default"), util.DEFAULT_RELAY);
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(util.escapeHtml(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
});
