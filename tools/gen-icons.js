// 用 Node 自带 zlib 生成 PNG 图标（无第三方依赖）：
// 蓝色底 + 两张倾斜的「词卡」，呼应游戏玩法。
// 运行：node tools/gen-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG 编码 ----------
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 形状 ----------
// 圆角矩形 SDF（返回 <0 表示点在内部）
function sdfRoundRect(px, py, cx, cy, w, h, rot, r) {
  const dx = px - cx, dy = py - cy;
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const qx = Math.abs(lx) - (w / 2 - r);
  const qy = Math.abs(ly) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const BLUE_TOP = [56, 178, 255], BLUE_BOTTOM = [24, 132, 229];
const WHITE = [255, 255, 255, 255];
const ORANGE = [255, 159, 28, 255];
const LINE = [180, 205, 228, 255];

// card 参数用归一化坐标（0~1），inner 用于 maskable 图标把内容缩进安全区
function drawIcon(size, variant) {
  const inner = variant === 'maskable' ? 0.76 : 1.0; // 内容缩放
  const rgba = Buffer.alloc(size * size * 4);
  const shapes = buildShapes(inner);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      let col = null;
      if (variant === 'any') {
        // 圆角方形底，四角透明
        const d = sdfRoundRect(u, v, 0.5, 0.5, 1.0, 1.0, 0, 0.20);
        if (d >= 0) continue;
      }
      const t = v; // 上下渐变
      col = [
        Math.round(BLUE_TOP[0] + (BLUE_BOTTOM[0] - BLUE_TOP[0]) * t),
        Math.round(BLUE_TOP[1] + (BLUE_BOTTOM[1] - BLUE_TOP[1]) * t),
        Math.round(BLUE_TOP[2] + (BLUE_BOTTOM[2] - BLUE_TOP[2]) * t),
        255
      ];
      for (const s of shapes) {
        if (sdfRoundRect(u, v, s.cx, s.cy, s.w, s.h, s.rot, s.r) < 0) { col = s.color; }
      }
      const i = (y * size + x) * 4;
      if (col) { rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = col[3]; }
    }
  }
  return encodePNG(size, size, rgba);
}

// 两张叠放的词卡：后面橙色、前面白色带两条“字行”，都微微倾斜
function buildShapes(k) {
  const S = (cx, cy, w, h, rot, r, color) => ({ cx: 0.5 + (cx - 0.5) * k, cy: 0.5 + (cy - 0.5) * k, w: w * k, h: h * k, rot, r: r * k, color });
  return [
    S(0.585, 0.545, 0.36, 0.48, -0.14, 0.055, ORANGE),
    S(0.44, 0.47, 0.36, 0.48, 0.12, 0.055, WHITE),
    S(0.44, 0.415, 0.20, 0.045, 0.12, 0.02, LINE),
    S(0.42, 0.49, 0.14, 0.045, 0.12, 0.02, LINE)
  ];
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-512.png', 512, 'any'],
  ['icon-192.png', 192, 'any'],
  ['icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'maskable']
];
for (const [name, size, variant] of jobs) {
  fs.writeFileSync(path.join(outDir, name), drawIcon(size, variant));
  console.log('written', name);
}
