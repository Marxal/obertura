/**
 * Pure Node.js icon generator — no npm deps needed.
 *
 * Reads the 512×512 master at public/icons/icon-master.png and produces the PWA
 * sizes the manifest needs:
 *   - icon-192.png          192×192, "any"      (down-sampled master)
 *   - icon-512.png          512×512, "any"      (the master, re-encoded)
 *   - icon-512-maskable.png 512×512, "maskable" (master shrunk + padded so
 *                           Android can crop it to a circle/squircle safely)
 *
 * It bundles a tiny PNG decoder (non-interlaced, 8-bit, grey/RGB/RGBA/palette)
 * and a box-average resampler, then re-encodes to plain RGB PNGs. The master is
 * opaque; any transparency is flattened onto the warm brand background.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { deflateSync, inflateSync } from 'zlib';

const MASTER = 'public/icons/icon-master.png';
const BG = [243, 234, 215]; // #f3ead7 — brand cream, used to flatten any alpha
// How much of the maskable canvas the logo fills. Android's safe zone is the
// central 80% circle, so 0.8 keeps the whole mark inside it with even padding.
const MASKABLE_SCALE = 0.8;

// ── CRC-32 (for chunk checksums) ──
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

// ── Decode a PNG into a flat RGB Uint8Array (alpha flattened onto BG) ──
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth} (want 8)`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);

  let palette = null, trns = null, idat = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
    if (type === 'IEND') break;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;             // bytes per pixel for the filter step
  const stride = W * bpp;
  const pixels = Buffer.alloc(H * stride);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[p++];
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[x] = r & 0xff;
    }
    cur.copy(prev);
  }

  // Expand to flat RGB, flattening alpha over the brand cream.
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    let r, g, b, alpha = 255;
    if (colorType === 3) {                 // indexed
      const idx = pixels[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) alpha = trns[idx];
    } else if (colorType === 0) {          // grey
      r = g = b = pixels[i];
    } else if (colorType === 4) {          // grey + alpha
      r = g = b = pixels[i * 2]; alpha = pixels[i * 2 + 1];
    } else if (colorType === 2) {          // RGB
      r = pixels[i * 3]; g = pixels[i * 3 + 1]; b = pixels[i * 3 + 2];
    } else {                               // RGBA
      r = pixels[i * 4]; g = pixels[i * 4 + 1]; b = pixels[i * 4 + 2];
      alpha = pixels[i * 4 + 3];
    }
    if (alpha !== 255) {
      const t = alpha / 255;
      r = Math.round(r * t + BG[0] * (1 - t));
      g = Math.round(g * t + BG[1] * (1 - t));
      b = Math.round(b * t + BG[2] * (1 - t));
    }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  return { width: W, height: H, rgb };
}

// ── Box-average resampler. scale<1 shrinks the source into a centered region
// of the destination and edge-extends the rest (the padding for maskable). ──
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function resample(src, srcSize, dstSize, scale = 1, pad = BG) {
  const drawn = Math.round(dstSize * scale);
  const offset = Math.round((dstSize - drawn) / 2);
  const ratio = srcSize / drawn; // source pixels per drawn destination pixel
  const out = new Uint8Array(dstSize * dstSize * 3);

  // Pre-fill with the flat pad colour. Where the logo is drawn we overwrite it;
  // the rest stays a clean, streak-free border (the maskable's safe-zone margin).
  for (let i = 0; i < dstSize * dstSize; i++) {
    out[i * 3] = pad[0]; out[i * 3 + 1] = pad[1]; out[i * 3 + 2] = pad[2];
  }

  for (let dy = 0; dy < dstSize; dy++) {
    let sy0 = clamp((dy - offset) * ratio, 0, srcSize);
    let sy1 = clamp((dy - offset + 1) * ratio, 0, srcSize);
    if (sy1 <= sy0) continue; // padding row — leave the flat fill
    const iy0 = Math.floor(sy0), iy1 = Math.ceil(sy1);
    for (let dx = 0; dx < dstSize; dx++) {
      let sx0 = clamp((dx - offset) * ratio, 0, srcSize);
      let sx1 = clamp((dx - offset + 1) * ratio, 0, srcSize);
      if (sx1 <= sx0) continue; // padding column
      const ix0 = Math.floor(sx0), ix1 = Math.ceil(sx1);
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const w = wx * wy;
          if (w <= 0) continue;
          const si = (sy * srcSize + sx) * 3;
          r += src[si] * w; g += src[si + 1] * w; b += src[si + 2] * w; wsum += w;
        }
      }
      const di = (dy * dstSize + dx) * 3;
      out[di] = Math.round(r / wsum);
      out[di + 1] = Math.round(g / wsum);
      out[di + 2] = Math.round(b / wsum);
    }
  }
  return out;
}

// ── Encode a flat RGB array to a PNG ──
function encodePng(size, rgb) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 3);
    row[0] = 0; // filter: None
    for (let i = 0; i < size * 3; i++) row[1 + i] = rgb[y * size * 3 + i];
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

// ── Run ──
const master = decodePng(readFileSync(MASTER));
if (master.width !== master.height) {
  throw new Error(`master must be square, got ${master.width}×${master.height}`);
}
const SRC = master.width;
console.log(`✓  read ${MASTER} (${SRC}×${SRC})`);

// Maskable padding colour = the average of the master's four corners, so the
// added border matches the master's own background and the seam disappears.
const corner = (x, y) => { const i = (y * SRC + x) * 3; return [master.rgb[i], master.rgb[i + 1], master.rgb[i + 2]]; };
const corners = [corner(0, 0), corner(SRC - 1, 0), corner(0, SRC - 1), corner(SRC - 1, SRC - 1)];
const padColor = [0, 1, 2].map((c) => Math.round(corners.reduce((s, p) => s + p[c], 0) / corners.length));
console.log(`   maskable pad colour rgb(${padColor.join(',')})`);

mkdirSync('public/icons', { recursive: true });

const outputs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, MASKABLE_SCALE],
];
for (const [name, size, scale] of outputs) {
  const rgb = resample(master.rgb, SRC, size, scale, padColor);
  writeFileSync(`public/icons/${name}`, encodePng(size, rgb));
  console.log(`✓  public/icons/${name}${scale < 1 ? ' (maskable, padded)' : ''}`);
}
