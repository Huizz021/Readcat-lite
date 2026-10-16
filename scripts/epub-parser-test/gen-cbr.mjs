/**
 * 生成测试用 CBR 文件（RAR3 格式）
 *
 * 本机通常没有 rar 命令行工具，所以按 RAR3 规范手工构造。
 * 关键点：MARK_HEAD 之后必须先有一个主头块（HEAD_TYPE 0x73），
 * 否则 unrar 会认为归档有效但解不出任何条目。
 *
 * 刻意包含三类情况：
 *   1. 自然序陷阱：page2 与 page10 —— 字符串排序会把 page10 排到 page2 前面
 *   2. 垃圾条目：__MACOSX/、.DS_Store —— 必须被忽略
 *   3. ComicInfo.xml —— 事实标准元数据
 *
 * 用法：node scripts/epub-parser-test/gen-cbr.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createExtractorFromData } from 'node-unrar-js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(dir, 'fixtures', 'test-comic.cbr');

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

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/** 构造一个 RAR3 块头：CRC(2) TYPE(1) FLAGS(2) SIZE(2) + 负载 */
const block = (type, flags, extra, body) => {
  const size = 7 + extra.length + body.length;
  const h = Buffer.alloc(size);
  let o = 0;
  h.writeUInt16LE(0, o); o += 2;
  h[o++] = type;
  h.writeUInt16LE(flags, o); o += 2;
  h.writeUInt16LE(size, o); o += 2;
  for (const b of extra) {
    h[o++] = b;
  }
  body.copy(h, o);
  // HEAD_CRC 只取低 16 位
  h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff, 0);
  return h;
};

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return [...b];
};

const main = async () => {
  // 用已有的 PDF 当图片字节来源，只取前若干字节，避免引入额外依赖
  const src = fs.readFileSync(path.join(dir, 'fixtures', 'sample.pdf'));
  const chunk = (from, to) => [...src.subarray(from, to)];

  const entries = [
    { name: 'page1.png', data: chunk(0, 2000) },
    { name: 'page2.png', data: chunk(2000, 4000) },
    { name: 'page10.png', data: chunk(4000, 6000) },
    { name: '__MACOSX/._page1.png', data: [...Buffer.from('junk')] },
    { name: 'ComicInfo.xml', data: [...Buffer.from('<ComicInfo><Series>RAR 测试漫画</Series><Writer>测试作者</Writer><Summary>合成 RAR 测试文件</Summary></ComicInfo>')] }
  ];

  const parts = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  // 主头块：缺了它 unrar 解不出条目
  parts.push(block(0x73, 0x0000, [0, 0, 0, 0, 0, 0], Buffer.alloc(0)));

  for (const e of entries) {
    const name = Buffer.from(e.name, 'ascii');
    const data = Buffer.from(e.data);
    const extra = [
      ...u32(data.length), ...u32(data.length),
      3,                                  // HOST_OS = Windows
      ...u32(crc32(data)),                // FILE_CRC
      ...u32(0x50000000),                 // FTIME
      20,                                 // UNP_VER = 2.0
      0x30,                               // METHOD = 0x30（store，不压缩）
      ...u32(name.length).slice(0, 2),    // NAME_SIZE
      ...u32(0x20)                        // ATTR = 普通文件
    ];
    parts.push(block(0x74, 0x8000, extra, name));
    parts.push(data);
  }

  const rar = Buffer.concat(parts);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, rar);
  console.log(`已生成 ${outFile} (${rar.length} 字节)`);

  // 自校验：生成后立刻用 unrar 解一遍，确认格式真的能被识别
  const extractor = await createExtractorFromData({ data: rar });
  const { files } = await extractor.extract();
  const list = Array.isArray(files) ? files : [...files];
  console.log(`自校验解出 ${list.length} 个条目`);
  for (const f of list) {
    console.log(`  ${f.fileHeader.name}  size=${f.extraction ? f.extraction.length : 0}`);
  }
  if (list.length !== entries.length) {
    console.error('自校验失败：条目数不符');
    process.exit(1);
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
