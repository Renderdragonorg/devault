import zlib from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG buffer to { width, height, data: Uint8Array RGBA8 }.
 * Supports colour types 0/2/3/4/6 at bit depths 1/2/4/8/16, non-interlaced.
 * (That is every texture Minecraft ships; interlaced PNGs are rejected.)
 */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }

  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.ceil((channels * bitDepth) / 8);
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const lines = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      cur[i] = v;
    }
    cur.copy(lines, y * stride);
    prev = cur;
  }

  const rgba = new Uint8Array(width * height * 4);
  const max = (1 << bitDepth) - 1;
  const sample = (line, x) => {
    if (bitDepth === 8) return line[x];
    if (bitDepth === 16) return line[x * 2];
    const bit = x * bitDepth;
    const shift = 8 - bitDepth - (bit & 7);
    return (line[bit >> 3] >> shift) & max;
  };

  for (let y = 0; y < height; y++) {
    const line = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(line, x);
        rgba[o] = palette[idx * 3];
        rgba[o + 1] = palette[idx * 3 + 1];
        rgba[o + 2] = palette[idx * 3 + 2];
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        const g = max ? Math.round((sample(line, x) * 255) / max) : 0;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        const g = sample(line, x * 2);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = sample(line, x * 2 + 1);
      } else if (colorType === 2) {
        rgba[o] = sample(line, x * 3);
        rgba[o + 1] = sample(line, x * 3 + 1);
        rgba[o + 2] = sample(line, x * 3 + 2);
        rgba[o + 3] = 255;
      } else {
        rgba[o] = sample(line, x * 4);
        rgba[o + 1] = sample(line, x * 4 + 1);
        rgba[o + 2] = sample(line, x * 4 + 2);
        rgba[o + 3] = sample(line, x * 4 + 3);
      }
    }
  }

  return { width, height, data: rgba };
}

/** Encode { width, height, data: RGBA8 } to a PNG buffer. */
export function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Nearest-neighbour resize. If only `width` is given the height keeps aspect
 * ratio; pass `height` too for a forced size.
 */
export function scaleNearest(src, width, height) {
  const h = height ?? Math.max(1, Math.round((src.height * width) / src.width));
  const out = new Uint8Array(width * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const s = (sy * src.width + sx) * 4;
      const d = (y * width + x) * 4;
      out[d] = src.data[s];
      out[d + 1] = src.data[s + 1];
      out[d + 2] = src.data[s + 2];
      out[d + 3] = src.data[s + 3];
    }
  }
  return { width, height: h, data: out };
}

/**
 * Render an isometric Minecraft-style block icon.
 * Geometry matches the 1024px isometric reference (top 1.0, west 0.8, north 0.6).
 * `faces` = up to three textures: { up, north, west }. Sides fall back to `up`.
 */
export function renderBlockIso(size, faces) {
  const n = size;
  const s = n / 1024;
  const cx = n / 2;
  const topY = 9 * s;
  const halfW = 452.5 * s;
  const topH = 226 * s;
  const cubeH = 553 * s;

  const T = [cx, topY];
  const L = [cx - halfW, topY + topH];
  const R = [cx + halfW, topY + topH];
  const C = [cx, topY + 2 * topH];
  const Lb = [cx - halfW, topY + topH + cubeH];
  const Rb = [cx + halfW, topY + topH + cubeH];
  const B = [cx, topY + 2 * topH + cubeH];

  const out = new Uint8Array(n * n * 4);

  const face = (origin, e1, e2, tex, shade) => {
    if (!tex) return;
    const det = e1[0] * e2[1] - e1[1] * e2[0];
    if (det === 0) return;
    const minX = Math.max(0, Math.floor(Math.min(origin[0], origin[0] + e1[0], origin[0] + e2[0], origin[0] + e1[0] + e2[0])));
    const maxX = Math.min(n - 1, Math.ceil(Math.max(origin[0], origin[0] + e1[0], origin[0] + e2[0], origin[0] + e1[0] + e2[0])));
    const minY = Math.max(0, Math.floor(Math.min(origin[1], origin[1] + e1[1], origin[1] + e2[1], origin[1] + e1[1] + e2[1])));
    const maxY = Math.min(n - 1, Math.ceil(Math.max(origin[1], origin[1] + e1[1], origin[1] + e2[1], origin[1] + e1[1] + e2[1])));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const rx = px + 0.5 - origin[0];
        const ry = py + 0.5 - origin[1];
        const u = (rx * e2[1] - ry * e2[0]) / det;
        const v = (e1[0] * ry - e1[1] * rx) / det;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const tx = Math.min(tex.width - 1, Math.floor(u * tex.width));
        const ty = Math.min(tex.height - 1, Math.floor(v * tex.height));
        const sp = (ty * tex.width + tx) * 4;
        if (tex.data[sp + 3] === 0) continue;
        const dp = (py * n + px) * 4;
        out[dp] = Math.min(255, Math.round(tex.data[sp] * shade));
        out[dp + 1] = Math.min(255, Math.round(tex.data[sp + 1] * shade));
        out[dp + 2] = Math.min(255, Math.round(tex.data[sp + 2] * shade));
        out[dp + 3] = tex.data[sp + 3];
      }
    }
  };

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  // top face
  face(T, sub(R, T), sub(L, T), faces.up, 1.0);
  // left (west) face
  face(L, sub(C, L), sub(Lb, L), faces.west || faces.north || faces.up, 0.8);
  // right (north / front) face
  face(C, sub(R, C), sub(B, C), faces.north || faces.west || faces.up, 0.6);

  return { width: n, height: n, data: out };
}
