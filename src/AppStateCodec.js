import { gzip, Inflate } from "pako";

// Share links must stay well below browser URL limits. This also bounds the
// gzip trailer's declared output size before allocating decompressed state.
const maxShareStateBytes = 2 * 1024 * 1024;
const maxShareHashCharacters = maxShareStateBytes * 2;

const gzipDecode = v => {
  if (v.length < 18) {
    throw new Error("Invalid compressed state");
  }
  const length = v.length;
  const declaredSize =
    (v[length - 4]) +
    (v[length - 3] * 0x100) +
    (v[length - 2] * 0x10000) +
    (v[length - 1] * 0x1000000);
  if (declaredSize > maxShareStateBytes) {
    throw new Error("Shared state is too large");
  }
  const chunks = [];
  let decodedLength = 0;
  const inflater = new Inflate({ chunkSize: 64 * 1024 });
  inflater.onData = (chunk) => {
    decodedLength += chunk.length;
    if (decodedLength > maxShareStateBytes) {
      throw new Error("Shared state is too large");
    }
    chunks.push(chunk);
  };
  inflater.push(new Uint8Array(v), true);
  if (inflater.err) {
    throw new Error(inflater.msg || "Invalid compressed state");
  }
  const decoded = new Uint8Array(decodedLength);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.length;
  }
  return decoded;
};
const hexDecode = v => v.match(/.{2}/g).map(i => parseInt(i, 16));
const apDecode = v => v.match(/.{2}/g).map(i => (i.charCodeAt(0) - 97) * 16 + (i.charCodeAt(1) - 97));
const decoders = [
  v => gzipDecode(apDecode(v)),
  v => gzipDecode(hexDecode(v)),
  v => hexDecode(v),
  v => apDecode(v),
];
// hashDecode tries to decode the URI hash into an object.
export function hashDecode(v) {
  if (typeof v !== "string" || v.length > maxShareHashCharacters) {
    throw "Invalid state encoding";
  }
  v = v.toLowerCase();
  // Ignore tag prefix.
  const colIdx = v.indexOf(':');
  if (colIdx !== -1) {
    v = v.substring(colIdx + 1);
  }
  // Try all decoders. If none works, throw an error.
  for (const decoder of decoders) {
    try {
      return JSON.parse(new TextDecoder('utf8').decode(new Uint8Array(decoder(v))));
    } catch (e) { }
  }
  throw "Invalid state encoding";
}
// Encoder only does one combination: gzip and ap encoding.
export const hashEncode = (v) => {
  const d = new TextEncoder('utf8').encode(JSON.stringify(v));
  if (d.length > maxShareStateBytes) {
    throw new Error("Shared state is too large; save it as JSON instead.");
  }
  let h = Array.from(gzip(d, { level: 6 }))
    .map(i => String.fromCharCode(97 + Math.floor(i / 16)) + String.fromCharCode(97 + i % 16))
    .join('');
  const title = (v.title || '').trim();
  if (title) {
    h = title.replace(/[\/%#:\s]+/g, "_") + ":" + h;
  }
  if (h.length > maxShareHashCharacters) {
    throw new Error("Share link is too large; save the state as JSON instead.");
  }
  return h;
};
