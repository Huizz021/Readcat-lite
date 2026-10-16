/**
 * 生成测试用 CBZ 文件
 *
 * 刻意包含三类关键情况：
 *   1. 自然序陷阱：page2 与 page10 —— 按字符串排序会把 page10 排到 page2 前面
 *   2. 垃圾条目：__MACOSX/、.DS_Store、Thumbs.db —— 必须被忽略
 *   3. ComicInfo.xml —— 事实标准元数据，用于书名/作者/简介
 *
 * 每页 PNG 尺寸不同（10/20/30...），便于验证页面顺序是否真的正确。
 *
 * 用法：node scripts/epub-parser-test/gen-cbz.mjs
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(dir, 'fixtures', 'test-comic.cbz');

/* ---------- 极简 PNG 编码器（避免引入额外依赖） ---------- */

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

/** 生成 size×size 的纯色 PNG */
const makePng = (size, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const off = y * (1 + size * 3);
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

/* ---------- 组装 CBZ ---------- */

const COMIC_INFO = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Title>测试漫画</Title>
  <Series>测试漫画系列</Series>
  <Writer>测试作者</Writer>
  <Summary>这是用于验证 CBZ 解析的合成文件。</Summary>
  <PageCount>5</PageCount>
</ComicInfo>`;

const main = async () => {
  const zip = new JSZip();

  // 5 页，尺寸依次 10/20/30/40/50，颜色各不相同
  // 刻意用 page2 / page10 这种命名，制造自然序陷阱
  const pages = [
    { name: 'page1.png', size: 10, rgb: [255, 0, 0] },
    { name: 'page2.png', size: 20, rgb: [0, 255, 0] },
    { name: 'page10.png', size: 30, rgb: [0, 0, 255] },
    { name: 'page11.png', size: 40, rgb: [255, 255, 0] },
    { name: 'page20.png', size: 50, rgb: [255, 0, 255] }
  ];
  for (const p of pages) {
    zip.file(p.name, makePng(p.size, p.rgb));
  }

  // 垃圾条目，必须被解析器忽略
  zip.file('__MACOSX/._page1.png', Buffer.from('junk'));
  zip.file('.DS_Store', Buffer.from('junk'));
  zip.file('Thumbs.db', Buffer.from('junk'));
  zip.file('readme.txt', '这不是图片，应被忽略');

  // 元数据
  zip.file('ComicInfo.xml', COMIC_INFO);

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buffer);

  console.log(`已生成 ${outFile}`);
  console.log(`大小: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`预期页数: 5（page1, page2, page10, page11, page20）`);
  console.log(`预期书名: 测试漫画系列 / 作者: 测试作者`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
