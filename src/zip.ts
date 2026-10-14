/**
 * The smallest useful ZIP: one stored (uncompressed) file. Save files go out
 * as .zip because that is a format every host lets a page download; the
 * entry inside is already gzipped.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipOne(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = 30 + nameBytes.length;
  const central = 46 + nameBytes.length;
  const out = new Uint8Array(local + data.length + central + 22);
  const v = new DataView(out.buffer);
  // Local file header.
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, data.length, true);
  v.setUint32(22, data.length, true);
  v.setUint16(26, nameBytes.length, true);
  out.set(nameBytes, 30);
  out.set(data, local);
  // Central directory entry.
  const c = local + data.length;
  v.setUint32(c, 0x02014b50, true);
  v.setUint16(c + 4, 20, true);
  v.setUint16(c + 6, 20, true);
  v.setUint32(c + 16, crc, true);
  v.setUint32(c + 20, data.length, true);
  v.setUint32(c + 24, data.length, true);
  v.setUint16(c + 28, nameBytes.length, true);
  out.set(nameBytes, c + 46);
  // End of central directory.
  const e = c + central;
  v.setUint32(e, 0x06054b50, true);
  v.setUint16(e + 8, 1, true);
  v.setUint16(e + 10, 1, true);
  v.setUint32(e + 12, central, true);
  v.setUint32(e + 16, c, true);
  return out;
}

/** The first file in a ZIP made by zipOne (stored, not deflated), or the bytes as they are. */
export function unzipOne(b: Uint8Array): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 30 || v.getUint32(0, true) !== 0x04034b50) return b;
  if (v.getUint16(8, true) !== 0) throw new Error('That zip was re-compressed; save the pond again from evoland.');
  const size = v.getUint32(18, true);
  const start = 30 + v.getUint16(26, true) + v.getUint16(28, true);
  return b.subarray(start, start + size);
}
