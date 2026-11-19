// Generates the PWA icons (icons/icon-192.png, icon-512.png, icon-maskable-512.png)
// with zero dependencies: draws a gold euro sign on black and encodes it as PNG via zlib.
// Run once: node make-icons.js

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- minimal PNG encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- euro glyph, geometric ---------- */

const FG = [244, 194, 75]; // gold
const BG = [0, 0, 0];     // black

// u, v in [-0.5, 0.5]; R = outer radius as a fraction of image width.
function glyph(u, v, R) {
  const dist = Math.hypot(u, v);
  const ang = Math.atan2(v, u);
  // C-shape: ring with a gap on the right side
  if (dist >= R * 0.58 && dist <= R && Math.abs(ang) > 0.55) return true;
  // two horizontal bars crossing the C, poking out to the right
  const barHalfH = R * 0.115;
  for (const by of [-R * 0.17, R * 0.17]) {
    if (Math.abs(v - by) <= barHalfH && u >= -R * 0.85 && u <= R * 1.15) return true;
  }
  return false;
}

function render(size, R) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size - 0.5;
          const v = (y + (sy + 0.5) / SS) / size - 0.5;
          if (glyph(u, v, R)) hit++;
        }
      }
      const a = hit / (SS * SS);
      const i = (y * size + x) * 4;
      px[i] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      px[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      px[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      px[i + 3] = 255;
    }
  }
  return encodePNG(size, px);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), render(192, 0.40));
fs.writeFileSync(path.join(dir, 'icon-512.png'), render(512, 0.40));
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), render(512, 0.30)); // inside the 80% maskable safe zone
console.log('Icons written: icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png');
