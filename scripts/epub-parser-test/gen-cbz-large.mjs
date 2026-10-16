/**
 * 生成大体积 CBZ，用于验证导入耗时与存储占用
 *
 * 用随机噪声生成图片（纯色图会被压缩到几 KB，无法反映真实漫画的体积）。
 *
 * 用法：node scripts/epub-parser-test/gen-cbz-large.mjs [页数] [宽] [高]
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pageCount = Number(process.argv[2] || 20);
const width = Number(process.argv[3] || 800);
const height = Number(process.argv[4] || 1200);
const outFile = path.join(dir, 'fixtures', `large-comic-${pageCount}p.cbz`);

const crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
};

/** 噪声图，压缩率接近真实扫描页 */
const makeNoisePng = (w, h, seed) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  let s = seed;
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      raw[off + 1 + x * 3] = s & 0xff;
      raw[off + 2 + x * 3] = (s >> 8) & 0xff;
      raw[off + 3 + x * 3] = (s >> 16) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

const main = async () => {
  const zip = new JSZip();
  let totalImageBytes = 0;
  for (let i = 1; i <= pageCount; i++) {
    const png = makeNoisePng(width, height, i * 7919);
    totalImageBytes += png.length;
    zip.file(`page${i}.png`, png, { compression: 'STORE' });
    if (i % 5 === 0) {
      process.stdout.write(`  已生成 ${i}/${pageCount} 页\r`);
    }
  }
  process.stdout.write('\n');

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buffer);

  const mb = v => (v / 1024 / 1024).toFixed(1);
  console.log(`已生成 ${outFile}`);
  console.log(`  页数: ${pageCount}，尺寸: ${width}x${height}`);
  console.log(`  图片原始总量: ${mb(totalImageBytes)} MB`);
  console.log(`  CBZ 文件大小: ${mb(buffer.length)} MB`);
  console.log('');
  console.log(`预期存储占用（base64 后按 UTF-16 计）: ${mb(totalImageBytes * 1.34 * 2)} MB`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
