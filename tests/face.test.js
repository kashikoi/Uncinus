const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/face.js");

const fakeFace = (len) => {
  const prefix = "data:image/jpeg;base64,";
  return prefix + "A".repeat(len - prefix.length);
};

test("validates face data URLs", () => {
  assert.ok(F.isFaceDataUrl(fakeFace(5000)));
  assert.ok(!F.isFaceDataUrl(fakeFace(F.FACE_MAX + 1)), "too big");
  assert.ok(!F.isFaceDataUrl("data:image/svg+xml;base64,AAAA"), "svg is not allowed");
  assert.ok(!F.isFaceDataUrl('data:image/jpeg;base64,AA"onerror="x'), "no markup");
  assert.ok(!F.isFaceDataUrl("https://example.com/me.jpg"));
  assert.ok(!F.isFaceDataUrl(null));
});

test("chunks fit inside the relay's 2 KB player message cap", () => {
  const chunks = F.chunkFace(fakeFace(F.FACE_MAX), 7);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(JSON.stringify(c).length < 2048);
});

test("assembler rebuilds a face from out-of-order chunks", () => {
  const face = fakeFace(7000);
  const chunks = F.chunkFace(face, 3).reverse();
  const asm = F.createFaceAssembler();
  const results = chunks.map((c) => asm.accept("aaaaaa", c));
  assert.deepEqual(results.slice(0, -1), new Array(chunks.length - 1).fill(null));
  assert.deepEqual(results.at(-1), { face });
});

test("a newer photo replaces a partial older one; players are kept apart", () => {
  const asm = F.createFaceAssembler();
  const old = F.chunkFace(fakeFace(4000), 1);
  const next = F.chunkFace(fakeFace(4500), 2);
  const other = F.chunkFace(fakeFace(3000), 1);
  asm.accept("aaaaaa", old[0]);
  for (const c of other) asm.accept("bbbbbb", c);
  let done = null;
  for (const c of next) done = asm.accept("aaaaaa", c);
  assert.equal(done.face.length, 4500);
  assert.equal(asm.accept("aaaaaa", old[1]), null, "stale chunk alone doesn't complete");
});

test("clearing and malformed chunks", () => {
  const asm = F.createFaceAssembler();
  assert.deepEqual(asm.accept("aaaaaa", F.chunkFace(null, 4)[0]), { face: null });
  assert.equal(asm.accept("aaaaaa", { t: "face", s: 1, i: 0, n: 1, d: "x".repeat(F.FACE_CHUNK + 1) }), null);
  assert.equal(asm.accept("aaaaaa", { t: "face", s: 1, i: 2, n: 1, d: "AAAA" }), null);
  assert.equal(asm.accept("aaaaaa", { t: "face", s: 1, i: 0, n: 999, d: "AAAA" }), null);
  assert.equal(asm.accept("aaaaaa", { t: "face", s: 1, i: 0, n: 1, d: "data:image/svg+xml;base64,AAAA" }), null);
});
