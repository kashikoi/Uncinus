/* Uncinus — minimal QR code encoder (byte mode, error-correction level M, versions 1–10).
   Enough for join URLs up to ~200 characters, with no external dependencies. */
(function (root) {
  "use strict";

  const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const MAX_VERSION = 10;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function dataCapacity(ver) {
    return Math.floor(rawModules(ver) / 8) - EC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let rootVal = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], rootVal);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      rootVal = gfMul(rootVal, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
    }
    return result;
  }

  function utf8(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  function buildCodewords(bytes, ver) {
    const ccBits = ver <= 9 ? 8 : 16;
    const capBits = dataCapacity(ver) * 8;
    const bits = [];
    const push = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, ccBits);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    const numBlocks = NUM_BLOCKS[ver];
    const ecLen = EC_PER_BLOCK[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const numShort = numBlocks - (raw % numBlocks);
    const shortLen = Math.floor(raw / numBlocks);
    const divisor = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const len = shortLen - ecLen + (i < numShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
    }
    const out = [];
    const maxData = shortLen - ecLen + 1;
    for (let i = 0; i < maxData; i++) blocks.forEach((b) => i < b.dat.length && out.push(b.dat[i]));
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ecc[i]));
    return out;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function makeMatrix(ver, codewords, forcedMask) {
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => {
      mod[y][x] = dark;
      fn[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    const pos = ALIGN[ver];
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    const drawFormat = (mask) => {
      const data = mask; // ECC level M encodes as 0b00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6));
      setFn(8, 8, bit(7));
      setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFn(a, b, dark);
        setFn(b, a, dark);
      }
    }

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && i < codewords.length * 8) {
            mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }

    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };

    let best = forcedMask;
    if (best == null) {
      let bestScore = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m);
        drawFormat(m);
        const score = penalty(mod);
        if (score < bestScore) {
          bestScore = score;
          best = m;
        }
        applyMask(m);
      }
    }
    applyMask(best);
    drawFormat(best);
    return { size, modules: mod, mask: best };
  }

  function penalty(mod) {
    const size = mod.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(mod[y]);
    for (let x = 0; x < size; x++) lines.push(mod.map((row) => row[x]));
    const finderA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].join("");
    const finderB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1].join("");
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      const str = line.map((v) => (v ? 1 : 0)).join("");
      for (let i = str.indexOf(finderA); i >= 0; i = str.indexOf(finderA, i + 1)) score += 40;
      for (let i = str.indexOf(finderB); i >= 0; i = str.indexOf(finderB, i + 1)) score += 40;
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const c = mod[y][x];
          if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
        }
      }
    }
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }

  function encode(text, options = {}) {
    const bytes = utf8(text);
    for (let ver = options.minVersion || 1; ver <= MAX_VERSION; ver++) {
      const needed = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
      if (needed <= dataCapacity(ver) * 8) {
        const result = makeMatrix(ver, buildCodewords(bytes, ver), options.mask);
        result.version = ver;
        return result;
      }
    }
    throw new Error("Text is too long for a QR code.");
  }

  function toSvg(text, options = {}) {
    const { size, modules } = encode(text, options);
    const quiet = 4;
    const dim = size + quiet * 2;
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
    const fg = options.color || "#0f172a";
    const bg = options.background || "#ffffff";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
  }

  const api = { encode, toSvg };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.qr = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
