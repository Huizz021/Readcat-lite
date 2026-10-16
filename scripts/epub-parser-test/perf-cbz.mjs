/**
 * CBZ 导入性能测试
 *
 * 关注点：漫画图片以 base64 存进 IndexedDB（字符串按 UTF-16 计），
 * 体积会明显放大，需要实测导入耗时与真实存储占用。
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/perf-cbz.mjs [cbz路径]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cbzPath = path.resolve(process.argv[2] || path.join(dir, 'fixtures', 'large-comic-20p.cbz'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  const fileSize = fs.statSync(cbzPath).size;
  console.log(`测试文件: ${path.basename(cbzPath)} (${(fileSize / 1024 / 1024).toFixed(1)} MB)\n`);

  const client = await connectPage();

  await client.evaluate(`(async () => {
    const books = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    for (const b of books) { await GLOBAL_DB.store.bookshelfStore.remove(b.id); }
    const texts = (await GLOBAL_DB.store.textContentStore.getAll()) || [];
    for (const t of texts) { await GLOBAL_DB.store.textContentStore.remove(t.id); }
    return true;
  })()`);
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);

  // ---- 拖入并等待解析完成 ----
  const size = JSON.parse(await client.evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  const x = Math.floor(size.w / 2);
  const y = Math.floor(size.h / 2);
  const data = { items: [], files: [cbzPath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
  await sleep(300);
  for (let i = 0; i < 5; i++) {
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await sleep(700);
    const d = await client.evaluate(`document.querySelector('.file-drag-container') ? getComputedStyle(document.querySelector('.file-drag-container')).display : 'none'`);
    if (d !== 'none') {
      break;
    }
  }
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await sleep(300);

  const parseStart = Date.now();
  await client.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });

  // 轮询直到导入窗口出现结果
  let parseMs = 0;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ready = await client.evaluate(`(() => {
      const root = document.querySelector('.import-books-window');
      if (!root) return false;
      const el = root.querySelector('li.bookname input');
      return !!(el && el.value);
    })()`);
    if (ready) {
      parseMs = Date.now() - parseStart;
      break;
    }
  }
  console.log(`解析 + 预览耗时: ${(parseMs / 1000).toFixed(1)} 秒`);

  const info = JSON.parse(await client.evaluate(`(() => {
    const root = document.querySelector('.import-books-window');
    const val = sel => { const el = root.querySelector(sel); return el ? el.value : null; };
    return JSON.stringify({
      bookname: val('li.bookname input'),
      pages: (root.innerText.match(/共(\\d+)章/) || [])[1] || null
    });
  })()`));
  console.log(`书名: ${info.bookname}，页数: ${info.pages}\n`);

  // ---- 点击导入并计时 ----
  const importStart = Date.now();
  await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const t = btns.find(b => b.innerText.trim() === '导入');
    if (t) t.click();
    return !!t;
  })()`);

  let importMs = 0;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const done = await client.evaluate(`(async () => {
      const all = await GLOBAL_DB.store.bookshelfStore.getAll();
      return (all || []).length > 0;
    })()`);
    if (done) {
      importMs = Date.now() - importStart;
      break;
    }
  }
  console.log(`写入 IndexedDB 耗时: ${(importMs / 1000).toFixed(1)} 秒`);

  // ---- 真实存储占用 ----
  const usage = JSON.parse(await client.evaluate(`(async () => {
    const est = await navigator.storage.estimate();
    const texts = (await GLOBAL_DB.store.textContentStore.getAll()) || [];
    let chars = 0;
    for (const t of texts) {
      for (const s of t.textContent) { chars += s.length; }
    }
    return JSON.stringify({ usage: est.usage, quota: est.quota, chars });
  })()`));
  const mb = v => (v / 1024 / 1024).toFixed(1);
  console.log(`\nIndexedDB 实际占用: ${mb(usage.usage)} MB`);
  console.log(`存储配额: ${mb(usage.quota)} MB`);
  console.log(`正文字符数: ${usage.chars.toLocaleString()}（按 UTF-16 计约 ${mb(usage.chars * 2)} MB）`);
  console.log(`\n体积放大倍数: ${(usage.usage / fileSize).toFixed(2)}x`);

  client.close();
}

main().catch(e => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
