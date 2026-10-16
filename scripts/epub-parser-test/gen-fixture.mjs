/**
 * 把 fixtures 目录下的真实 epub 转成 fixture.js，供测试页面读取
 *
 * 用法：node scripts/epub-parser-test/gen-fixture.mjs [epub文件路径]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DEFAULT_FIXTURE = 'pg1342.epub';

export const generateFixture = (source) => {
  if (!fs.existsSync(source)) {
    return false;
  }
  const base64 = fs.readFileSync(source).toString('base64');
  const target = path.join(path.dirname(source), '..', 'fixture.js');
  fs.writeFileSync(target, `window.__EPUB_FIXTURE__ = ${JSON.stringify(base64)};\n`, { encoding: 'utf-8' });
  console.log(`已生成 fixture.js，源文件 ${source}，base64 长度 ${base64.length}`);
  return true;
}

const entry = process.argv[1] || '';
if (entry.endsWith('gen-fixture.mjs')) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const source = process.argv[2] || path.join(dir, 'fixtures', DEFAULT_FIXTURE);
  if (!generateFixture(source)) {
    console.error(`未找到 epub 文件: ${source}`);
    process.exit(2);
  }
}
