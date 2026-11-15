import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC_ICON = path.resolve(process.cwd(), 'public', 'instrop-icon.png');
const targetArgIndex = process.argv.indexOf('--target');
const TARGET_RES_DIR =
  targetArgIndex !== -1 && process.argv[targetArgIndex + 1]
    ? path.resolve(process.cwd(), process.argv[targetArgIndex + 1])
    : path.resolve(process.cwd(), 'android', 'app', 'src', 'main', 'res');

if (!fs.existsSync(SRC_ICON)) {
  console.error('Missing source icon:', SRC_ICON);
  process.exit(1);
}

if (!fs.existsSync(TARGET_RES_DIR)) {
  console.error(
    'Android res folder not found at:',
    TARGET_RES_DIR,
    '\nRun "npx cap add android" first, then run "npm run android:icons".'
  );
  process.exit(1);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePngRgba(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePngRgba(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  const idats = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[rowOut + x - bpp] : 0;
      const b = y > 0 ? out[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[rowOut - stride + x - bpp] : 0;
      let val = raw[rowIn + x];
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (val + pr) & 0xff;
      }
      out[rowOut + x] = val;
    }
  }
  return { w, h, rgba: out };
}

function resizeRgba(src, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  const scaleX = src.w / dstW;
  const scaleY = src.h / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * scaleX));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < src.h; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.w; sx++) {
          const i = (sy * src.w + sx) * 4;
          r += src.rgba[i];
          g += src.rgba[i + 1];
          b += src.rgba[i + 2];
          a += src.rgba[i + 3];
          n++;
        }
      }
      const o = (y * dstW + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = Math.round(a / n);
    }
  }
  return { w: dstW, h: dstH, rgba: dst };
}

function createForegroundLayer(src, canvasSize) {
  const innerSize = Math.round(canvasSize * 0.78);
  const scaled = resizeRgba(src, innerSize, innerSize);
  const canvas = Buffer.alloc(canvasSize * canvasSize * 4);
  const offset = Math.floor((canvasSize - innerSize) / 2);

  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const si = (y * innerSize + x) * 4;
      const r = scaled.rgba[si];
      const g = scaled.rgba[si + 1];
      const b = scaled.rgba[si + 2];
      const a = scaled.rgba[si + 3];

      // Strip the dark #09090B canvas background so Android adaptive icon mask & parallax stay clean
      const maxChannel = Math.max(r, g, b);
      const isDarkBg = maxChannel < 36;
      const di = ((y + offset) * canvasSize + (x + offset)) * 4;

      if (isDarkBg) {
        canvas[di] = 0;
        canvas[di + 1] = 0;
        canvas[di + 2] = 0;
        canvas[di + 3] = 0;
      } else {
        canvas[di] = r;
        canvas[di + 1] = g;
        canvas[di + 2] = b;
        canvas[di + 3] = a;
      }
    }
  }

  return encodePngRgba(canvasSize, canvasSize, canvas);
}

function createRoundIcon(src, size) {
  const scaled = resizeRgba(src, size, size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > radius) {
        scaled.rgba[(y * size + x) * 4 + 3] = 0;
      } else if (dist > radius - 1.2) {
        const edgeAlpha = Math.max(0, Math.min(1, radius - dist));
        const idx = (y * size + x) * 4 + 3;
        scaled.rgba[idx] = Math.round(scaled.rgba[idx] * edgeAlpha);
      }
    }
  }
  return encodePngRgba(size, size, scaled.rgba);
}

function createRoundedSquareIcon(src, size) {
  const scaled = resizeRgba(src, size, size);
  const cornerRadius = size * 0.22;
  const half = size / 2;
  const inner = half - cornerRadius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - half) - inner);
      const dy = Math.max(0, Math.abs(y + 0.5 - half) - inner);
      const dist = Math.hypot(dx, dy);
      if (dist > cornerRadius) {
        scaled.rgba[(y * size + x) * 4 + 3] = 0;
      } else if (dist > cornerRadius - 1.2) {
        const edgeAlpha = Math.max(0, Math.min(1, cornerRadius - dist));
        const idx = (y * size + x) * 4 + 3;
        scaled.rgba[idx] = Math.round(scaled.rgba[idx] * edgeAlpha);
      }
    }
  }
  return encodePngRgba(size, size, scaled.rgba);
}

function createSolidBackgroundLayer(size, r, g, b) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return encodePngRgba(size, size, buf);
}

const decoded = decodePngRgba(fs.readFileSync(SRC_ICON));

const densities = [
  { name: 'mdpi', legacy: 48, adaptive: 108 },
  { name: 'hdpi', legacy: 72, adaptive: 162 },
  { name: 'xhdpi', legacy: 96, adaptive: 216 },
  { name: 'xxhdpi', legacy: 144, adaptive: 324 },
  { name: 'xxxhdpi', legacy: 192, adaptive: 432 },
];

for (const d of densities) {
  const dir = path.join(TARGET_RES_DIR, `mipmap-${d.name}`);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'ic_launcher.png'),
    createRoundedSquareIcon(decoded, d.legacy)
  );
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_round.png'),
    createRoundIcon(decoded, d.legacy)
  );
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_foreground.png'),
    createForegroundLayer(decoded, d.adaptive)
  );
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_background.png'),
    createSolidBackgroundLayer(d.adaptive, 9, 9, 11)
  );
}

const anydpiDir = path.join(TARGET_RES_DIR, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpiDir, { recursive: true });

const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

console.log('Applied Instrop adaptive & launcher icons to:', TARGET_RES_DIR);
