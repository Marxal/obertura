/**
 * Pure Node.js PNG generator — no npm deps needed.
 * Produces a warm-background icon with an orange "O" ring.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

// CRC-32 table
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
function crc32(buf) {
  let v = 0xffffffff;
  for (const b of buf) v = CRC[(v ^ b) & 0xff] ^ (v >>> 8);
  return (v ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([lenBuf, t, data, crcBuf]);
}

function makePng(size, pixelFn) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 3);
    row[0] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelFn(x, y, size);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// #f3ead7 background, #ff9b21 ring for the letter "O"
function iconPixel(x, y, size) {
  const BG = [243, 234, 215]; // #f3ead7
  const FG = [255, 155, 33];  // #ff9b21
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.37;
  const inner = size * 0.21;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return d >= inner && d <= outer ? FG : BG;
}

mkdirSync('public/icons', { recursive: true });

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-512-maskable.png', 512],
]) {
  writeFileSync(`public/icons/${name}`, makePng(size, iconPixel));
  console.log(`✓  public/icons/${name}`);
}
