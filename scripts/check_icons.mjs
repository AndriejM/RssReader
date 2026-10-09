// Throwaway check: decode the generated PNGs and print coverage stats per size.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function decode(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('bad signature');

  let offset = 8;
  let width = 0;
  let height = 0;
  const idatParts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('unexpected colour type');
    } else if (type === 'IDAT') {
      idatParts.push(data);
    }
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error('unexpected filter byte');
    raw.copy(rgba, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, rgba };
}

for (const size of [16, 32, 48, 128]) {
  const { width, height, rgba } = decode(path.join(root, 'icons', `icon${size}.png`));
  let transparent = 0;
  let orange = 0;
  let white = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) transparent += 1;
    else if (rgba[i] > 240 && rgba[i + 1] > 240 && rgba[i + 2] > 240) white += 1;
    else orange += 1;
  }
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  console.log(
    `${size}: ${width}x${height} transparent=${transparent} fill=${orange} glyph=${white}`,
    `centerRGBA=${rgba[center]},${rgba[center + 1]},${rgba[center + 2]},${rgba[center + 3]}`,
  );
}
