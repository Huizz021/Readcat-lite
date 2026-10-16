/**
 * 解析 --dump-dom 的输出，打印验证报告
 *
 * 单独抽出来是因为部分受限环境不允许 Node 派生子进程，
 * 此时可以先用命令行手动执行浏览器，再对 dump 结果跑本脚本。
 *
 * 用法：node scripts/epub-parser-test/report.mjs <dump.html>
 */
import fs from 'fs';

/** 概要里可能包含 base64 图片，输出前做截断，避免刷屏 */
const shorten = (val) => {
  if (typeof val === 'string') {
    return val.length > 120 ? `${val.slice(0, 120)}…(共 ${val.length} 字符)` : val;
  }
  if (Array.isArray(val)) {
    return val.map(shorten);
  }
  if (val && typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, shorten(v)]));
  }
  return val;
}

export const reportFromHtml = (html) => {
  const match = /<pre id="rc-test-result">([\s\S]*?)<\/pre>/.exec(html);
  if (!match) {
    console.error('未在页面中找到测试结果。');
    console.error('--- 页面片段 ---');
    console.error(html.slice(0, 2000));
    return 2;
  }
  const payload = JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf-8'));
  for (const item of payload.results) {
    console.log(`${item.ok ? '[通过]' : '[失败]'} ${item.name}${item.ok ? '' : `\n        ${item.detail}`}`);
  }
  console.log(`\n合计 ${payload.total} 项，失败 ${payload.failed} 项`);
  if (payload.summary && Object.keys(payload.summary).length > 0) {
    console.log('\n--- 真实 epub 概要 ---');
    console.log(JSON.stringify(shorten(payload.summary), null, 2));
  }
  return payload.failed > 0 ? 1 : 0;
}

const entry = process.argv[1] || '';
if (entry.endsWith('report.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/epub-parser-test/report.mjs <dump.html>');
    process.exit(2);
  }
  process.exit(reportFromHtml(fs.readFileSync(file, 'utf-8')));
}
