import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const SRC_ICON = path.resolve(ROOT, 'public', 'instrop-icon.png');
const OUT_DIR = path.resolve(ROOT, 'build');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');
const OUT_PNG = path.join(OUT_DIR, 'icon.png');

if (!fs.existsSync(SRC_ICON)) {
  console.error('Missing source icon:', SRC_ICON);
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

function applyRoundedSquareMask(img) {
  const { w, h, rgba } = img;
  const out = Buffer.from(rgba);
  const cornerRadius = w * 0.22;
  const half = w / 2;
  const inner = half - cornerRadius;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - half) - inner);
      const dy = Math.max(0, Math.abs(y + 0.5 - half) - inner);
      const dist = Math.hypot(dx, dy);
      if (dist > cornerRadius) {
        out[(y * w + x) * 4 + 3] = 0;
      } else if (dist > cornerRadius - 1.2) {
        const edgeAlpha = Math.max(0, Math.min(1, cornerRadius - dist));
        const idx = (y * w + x) * 4 + 3;
        out[idx] = Math.round(out[idx] * edgeAlpha);
      }
    }
  }
  return { w, h, rgba: out };
}

function encodeBmpDibForIco(img) {
  const { w, h, rgba } = img;
  const xorSize = w * h * 4;
  const andRowStride = Math.ceil(w / 32) * 4;
  const andSize = andRowStride * h;
  const headerSize = 40;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);

  buf.writeUInt32LE(headerSize, 0);
  buf.writeInt32LE(w, 4);
  buf.writeInt32LE(h * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize, 20);

  let xorPos = headerSize;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      buf[xorPos++] = rgba[si + 2]; // B
      buf[xorPos++] = rgba[si + 1]; // G
      buf[xorPos++] = rgba[si];     // R
      buf[xorPos++] = rgba[si + 3]; // A
    }
  }

  const andBase = headerSize + xorSize;
  for (let y = h - 1; y >= 0; y--) {
    const outRow = (h - 1 - y) * andRowStride;
    for (let x = 0; x < w; x++) {
      const alpha = rgba[(y * w + x) * 4 + 3];
      if (alpha === 0) {
        const byteIdx = andBase + outRow + (x >> 3);
        buf[byteIdx] |= 1 << (7 - (x & 7));
      }
    }
  }

  return buf;
}

function buildIcoFile(decodedSrc) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const entries = sizes.map((size) => {
    const img = applyRoundedSquareMask(resizeRgba(decodedSrc, size, size));
    // Standard Vista+ / NSIS-compatible hybrid ICO: BMP DIB for <=128, PNG for 256x256
    const data = size >= 256 ? encodePngRgba(size, size, img.rgba) : encodeBmpDibForIco(img);
    return { size, data };
  });

  const headerSize = 6 + entries.length * 16;
  const totalSize = headerSize + entries.reduce((sum, e) => sum + e.data.length, 0);
  const ico = Buffer.alloc(totalSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(entries.length, 4);

  let dataOffset = headerSize;
  entries.forEach((entry, idx) => {
    const dirPos = 6 + idx * 16;
    ico[dirPos] = entry.size >= 256 ? 0 : entry.size;
    ico[dirPos + 1] = entry.size >= 256 ? 0 : entry.size;
    ico[dirPos + 2] = 0;
    ico[dirPos + 3] = 0;
    ico.writeUInt16LE(1, dirPos + 4);
    ico.writeUInt16LE(32, dirPos + 6);
    ico.writeUInt32LE(entry.data.length, dirPos + 8);
    ico.writeUInt32LE(dataOffset, dirPos + 12);
    entry.data.copy(ico, dataOffset);
    dataOffset += entry.data.length;
  });

  return ico;
}

const decoded = decodePngRgba(fs.readFileSync(SRC_ICON));
fs.mkdirSync(OUT_DIR, { recursive: true });

const png512 = applyRoundedSquareMask(resizeRgba(decoded, 512, 512));
fs.writeFileSync(OUT_PNG, encodePngRgba(512, 512, png512.rgba));
fs.writeFileSync(OUT_ICO, buildIcoFile(decoded));

console.log('Generated Windows desktop icons:', OUT_ICO, 'and', OUT_PNG);
