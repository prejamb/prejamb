/**
 * Generates the PreJamb PWA icons as PNGs + an SVG source.
 *
 * Dependency-free: encodes PNGs with Node's built-in `zlib`, and rasterizes a
 * graduation-cap mark (diamond mortarboard + trapezoid cap + button + tassel)
 * with simple geometry and 4× supersampling for anti-aliasing.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/icons");

/* ----------------------------- color helpers ------------------------------ */

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/* ------------------------------ canvas raster ----------------------------- */

function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4, 0) };
}

function setPixel(c, x, y, rgb, a = 255) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  c.data[i] = rgb[0];
  c.data[i + 1] = rgb[1];
  c.data[i + 2] = rgb[2];
  c.data[i + 3] = a;
}

function fillRect(c, x0, y0, x1, y1, rgb) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(c.size - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(c.size - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) setPixel(c, x, y, rgb);
  }
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function fillPolygon(c, pts, rgb) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const xa = Math.max(0, Math.floor(minX));
  const xb = Math.min(c.size - 1, Math.ceil(maxX));
  const ya = Math.max(0, Math.floor(minY));
  const yb = Math.min(c.size - 1, Math.ceil(maxY));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, pts)) setPixel(c, x, y, rgb);
    }
  }
}

function fillCircle(c, cx, cy, r, rgb) {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(c.size - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(c.size - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(c, x, y, rgb);
    }
  }
}

function fillLine(c, x0, y0, x1, y1, width, rgb) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  fillPolygon(
    c,
    [
      [x0 + nx, y0 + ny],
      [x0 - nx, y0 - ny],
      [x1 - nx, y1 - ny],
      [x1 + nx, y1 + ny],
    ],
    rgb,
  );
}

/* -------------------------------- renderer -------------------------------- */

const TOP = hexToRgb("#855ff4"); // primary-500
const BOTTOM = hexToRgb("#4d2ab0"); // primary-800
const BUTTON = hexToRgb("#5e33d6"); // primary-700
const WHITE = [255, 255, 255];

/**
 * @param {number} size       target pixel size (after downsampling)
 * @param {object} opts
 * @param {boolean} [opts.round]   round the background corners
 * @param {number}  [opts.glyphScale] scale of the glyph relative to the 512 canvas
 */
function render(size, { round = true, glyphScale = 1 } = {}) {
  const ss = 4;
  const S = size * ss;
  const c = makeCanvas(S);
  const radius = round ? (96 / 512) * S : 0;

  // Background gradient with optional rounded corners.
  for (let y = 0; y < S; y++) {
    const t = y / (S - 1);
    const rgb = mix(TOP, BOTTOM, t);
    for (let x = 0; x < S; x++) {
      if (radius > 0) {
        const nearestX = Math.max(radius - x, x - (S - 1 - radius), 0);
        const nearestY = Math.max(radius - y, y - (S - 1 - radius), 0);
        if (nearestX * nearestX + nearestY * nearestY > radius * radius) {
          continue;
        }
      }
      setPixel(c, x, y, rgb);
    }
  }

  // Glyph transform: 512-space coordinates → scaled canvas space, centered.
  const f = (S / 512) * glyphScale;
  const cx = S / 2;
  const cy = S / 2;
  const X = (x) => cx + (x - 256) * f;
  const Y = (y) => cy + (y - 256) * f;
  const P = (pts) => pts.map(([x, y]) => [X(x), Y(y)]);

  // Mortarboard diamond + cap base.
  fillPolygon(c, P([[256, 150], [410, 205], [256, 260], [102, 205]]), WHITE);
  fillPolygon(c, P([[172, 260], [340, 260], [316, 336], [196, 336]]), WHITE);

  // Tassel cord + knob (drawn before the button so it sits behind it).
  fillLine(c, X(256), Y(205), X(372), Y(250), 11 * f, WHITE);
  fillCircle(c, X(380), Y(258), 15 * f, WHITE);

  // Button on top.
  fillCircle(c, X(256), Y(205), 17 * f, BUTTON);

  return downsample(c, size);
}

function downsample(c, targetSize) {
  const ss = c.size / targetSize;
  const out = makeCanvas(targetSize);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * c.size + (x * ss + sx)) * 4;
          r += c.data[i];
          g += c.data[i + 1];
          b += c.data[i + 2];
          a += c.data[i + 3];
        }
      }
      const n = ss * ss;
      const oi = (y * targetSize + x) * 4;
      out.data[oi] = Math.round(r / n);
      out.data[oi + 1] = Math.round(g / n);
      out.data[oi + 2] = Math.round(b / n);
      out.data[oi + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ------------------------------- PNG encode ------------------------------- */

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(c) {
  const { size: width, data: rgba } = c;
  const height = width;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePNG(name, c) {
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, encodePNG(c));
  console.log("wrote", path);
}

/* --------------------------------- run ------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });

writePNG("icon-192.png", render(192, { round: true, glyphScale: 1 }));
writePNG("icon-512.png", render(512, { round: true, glyphScale: 1 }));
writePNG("icon-maskable-512.png", render(512, { round: false, glyphScale: 0.68 }));
writePNG("apple-touch-icon.png", render(180, { round: false, glyphScale: 0.9 }));
