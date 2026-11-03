/* Uncinus — player face photos: validation plus chunking, because the relay caps phone messages at 2 KB. */
(function (root) {
  "use strict";

  const FACE_SIZE = 96; // px, square JPEG drawn on top of the player's block
  // The phone crops the square framing the guide oval: 84% of the square camera view, centred. Inside that
  // crop the oval spans the full height and 31/42 of it across; everything outside it is cut away when shown.
  const FACE_CROP = 0.84;
  const FACE_OVAL = { rx: 31 / 84, ry: 42 / 84 }; // radii as fractions of the photo's side
  const FACE_MAX = 16000; // max data-URL length accepted by the host
  const FACE_CHUNK = 1500; // data-URL characters per relay message
  const MAX_CHUNKS = Math.ceil(FACE_MAX / FACE_CHUNK);
  const FACE_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  function isFaceDataUrl(value) {
    return typeof value === "string" && value.length <= FACE_MAX && FACE_RE.test(value);
  }

  // Split a face into `{t:"face", s, i, n, d}` messages; `n: 0` clears the face.
  function chunkFace(dataUrl, seq) {
    if (!dataUrl) return [{ t: "face", s: seq, n: 0 }];
    if (!isFaceDataUrl(dataUrl)) throw new Error("Not a valid face image.");
    const n = Math.ceil(dataUrl.length / FACE_CHUNK);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ t: "face", s: seq, i, n, d: dataUrl.slice(i * FACE_CHUNK, (i + 1) * FACE_CHUNK) });
    return out;
  }

  // Host side: reassembles chunks per player. `accept` returns `{ face }` (a data URL or null to clear)
  // once a face is complete, otherwise null.
  function createFaceAssembler() {
    const pending = new Map();
    const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    return {
      accept(from, msg) {
        if (!msg || !isInt(msg.s, 0, Number.MAX_SAFE_INTEGER) || !isInt(msg.n, 0, MAX_CHUNKS)) return null;
        if (msg.n === 0) {
          pending.delete(from);
          return { face: null };
        }
        if (!isInt(msg.i, 0, msg.n - 1) || typeof msg.d !== "string" || !msg.d || msg.d.length > FACE_CHUNK) return null;
        let entry = pending.get(from);
        if (!entry || entry.s !== msg.s || entry.parts.length !== msg.n) {
          entry = { s: msg.s, parts: new Array(msg.n).fill(null), got: 0 };
          pending.set(from, entry);
        }
        if (entry.parts[msg.i] === null) entry.got++;
        entry.parts[msg.i] = msg.d;
        if (entry.got < msg.n) return null;
        pending.delete(from);
        const face = entry.parts.join("");
        return isFaceDataUrl(face) ? { face } : null;
      },
      forget(from) {
        pending.delete(from);
      },
    };
  }

  const api = { FACE_SIZE, FACE_CROP, FACE_OVAL, FACE_MAX, FACE_CHUNK, isFaceDataUrl, chunkFace, createFaceAssembler };
  root.Uncinus = root.Uncinus || {};
  root.Uncinus.face = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
