// Generates icons/icon{16,32,48,128}.png with no dependencies: the RSS glyph is drawn
// analytically and encoded as a plain RGBA PNG (zlib deflate + CRC32).
//
//   node scripts/make_icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BACKGROUND = [228, 87, 46]; // RSS orange
const FOREGROUND = [255, 255, 255];
const ROUNDED_RADIUS = 0.19;
const INSET = 0.03;
const ORIGIN_X = 0.24;
const ORIGIN_Y = 0.76;
const DOT_RADIUS = 0.085;
const RING_1 = [0.26, 0.38];
const RING_2 = [0.47, 0.59];
const SAMPLES = 3;

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Signed distance to the rounded square: negative inside, positive outside.
 * Standard rounded-box form: hypot(max(|p| - innerExtent, 0)) - radius.
 */
function roundedBoxDistance(x, y) {
  const innerExtent = 0.5 - INSET - ROUNDED_RADIUS;
  const dx = Math.max(Math.abs(x - 0.5) - innerExtent, 0);
  const dy = Math.max(Math.abs(y - 0.5) - innerExtent, 0);
  return Math.hypot(dx, dy) - ROUNDED_RADIUS;
}

function ringCovers(x, y, [inner, outer]) {
  const dx = x - ORIGIN_X;
  const dy = y - ORIGIN_Y;
  // Arcs open toward the upper-right only.
  if (dx < 0 || dy > 0) return false;
  const distance = Math.hypot(dx, dy);
  return distance >= inner && distance <= outer;
}

function sample(x, y) {
  if (roundedBoxDistance(x, y) > 0) return 'none';
  const isDot = Math.hypot(x - ORIGIN_X, y - ORIGIN_Y) <= DOT_RADIUS;
  if (isDot || ringCovers(x, y, RING_1) || ringCovers(x, y, RING_2)) return 'glyph';
  return 'background';
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const totalSamples = SAMPLES * SAMPLES;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let backgroundSamples = 0;
      let glyphSamples = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          const kind = sample(x, y);
          if (kind === 'background') backgroundSamples += 1;
          else if (kind === 'glyph') glyphSamples += 1;
        }
      }

      const covered = backgroundSamples + glyphSamples;
      const offset = (py * size + px) * 4;

      if (covered === 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
        continue;
      }

      const glyphFraction = glyphSamples / covered;
      rgba[offset] = Math.round(BACKGROUND[0] + (FOREGROUND[0] - BACKGROUND[0]) * glyphFraction);
      rgba[offset + 1] = Math.round(BACKGROUND[1] + (FOREGROUND[1] - BACKGROUND[1]) * glyphFraction);
      rgba[offset + 2] = Math.round(BACKGROUND[2] + (FOREGROUND[2] - BACKGROUND[2]) * glyphFraction);
      rgba[offset + 3] = Math.round((covered / totalSamples) * 255);
    }
  }

  return encodePng(size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log(`wrote ${file}`);
}
