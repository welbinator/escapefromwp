// Minimal dependency-free ZIP writer (STORE method, no compression).
// Works in Cloudflare Workers / Pages Functions — no Node, no deps.
// Usage: const bytes = zipSync([{ name: "a.txt", data: "hello" }, ...]);

const te = new TextEncoder();

// CRC32 with a lazily-built table.
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toBytes(data) {
  return typeof data === "string" ? te.encode(data) : data;
}

// Build a ZIP archive from [{ name, data }] where data is a string or Uint8Array.
export function zipSync(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  // DOS date/time (fixed — content tool, timestamps aren't meaningful here).
  const dosTime = 0;
  const dosDate = 0x2821; // 2026-01-01

  for (const f of files) {
    const nameBytes = te.encode(f.name);
    const dataBytes = toBytes(f.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);        // version needed
    lh.setUint16(6, 0x0800, true);    // flags: UTF-8 names
    lh.setUint16(8, 0, true);         // method: store
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);     // compressed size
    lh.setUint32(22, size, true);     // uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);        // extra len
    chunks.push(new Uint8Array(lh.buffer), nameBytes, dataBytes);

    // Central directory record
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);

  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const a of all) total += a.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
