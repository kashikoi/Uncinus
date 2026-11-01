const test = require("node:test");
const assert = require("node:assert/strict");
const qr = require("../js/qr.js");

// Reference matrices were cross-checked bit-for-bit against python-qrcode (byte mode, ECC M, all 8 masks).
test("picks the smallest version that fits", () => {
  assert.equal(qr.encode("A").version, 1);
  assert.equal(qr.encode("https://kashikoi.github.io/Uncinus/play.html?room=ABCD").version, 4);
  assert.equal(qr.encode("z".repeat(210)).version, 10);
  assert.throws(() => qr.encode("z".repeat(400)), /too long/);
});

test("finder patterns sit in three corners", () => {
  const { size, modules } = qr.encode("https://example.com/play.html?room=WXYZ");
  const finderAt = (x0, y0) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        if (modules[y0 + y][x0 + x] !== (d !== 2)) return false;
      }
    }
    return true;
  };
  assert.ok(finderAt(0, 0));
  assert.ok(finderAt(size - 7, 0));
  assert.ok(finderAt(0, size - 7));
});

test("known-good matrix for a short input (mask 0)", () => {
  const rows = qr.encode("Volutus", { mask: 0 }).modules.map((r) => r.map((c) => (c ? "#" : ".")).join(""));
  assert.equal(rows.length, 21);
  assert.equal(rows[0], "#######..##.#.#######");
  assert.equal(rows[8].slice(0, 9), "#.#.#.#..");
  assert.equal(rows[20], "#######.###.#.####.##");
});

test("toSvg returns an svg with a quiet zone", () => {
  const svg = qr.toSvg("hi");
  assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29"/);
  assert.match(svg, /<path d="M4 4h1v1h-1z/);
});
