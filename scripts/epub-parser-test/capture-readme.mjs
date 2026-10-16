/**
 * 为 README 拍摄应用截图
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/capture-readme.mjs <输出目录>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(dir, 'screenshots'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const client = await connectPage();

  // 用视口覆盖统一截图尺寸（不改动真实窗口，避免触发系统级操作）
  try {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    console.log('已设置视口 1280x800');
    await sleep(1500);
  } catch (e) {
    console.log('设置视口失败（按原尺寸截图）:', e.message);
  }

  await client.send('Page.enable');
  const shot = async (name) => {
    const res = await client.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    console.log(`已保存 ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  };

  // ---- 1. 书架 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(2800);
  await shot('bookshelf');

  // ---- 2. 搜索页 ----
  await client.evaluate(`location.hash = '#/search'`);
  await sleep(2800);
  await shot('search');

  // ---- 3. 阅读页：经详情页点章节进入 ----
  const nav = await client.evaluate(`(async () => {
    const books = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    const book = books.find(b => b.chapterList && b.chapterList.length > 1) || books[0];
    if (!book) return JSON.stringify({ ok: false, reason: '书架为空' });
    location.hash = '#/detail?pid=' + encodeURIComponent(book.pid) + '&detailUrl=' + encodeURIComponent(book.detailPageUrl);
    return JSON.stringify({ ok: true, name: book.bookname, detailUrl: book.detailPageUrl });
  })()`);
  console.log('详情页:', nav);
  await sleep(3500);
  const clicked = await client.evaluate(`(() => {
    const cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    const target = cols.find(c => c.querySelector('[data-index="1"]')) || cols[0];
    if (!target) return JSON.stringify({ ok: false, total: cols.length });
    target.click();
    return JSON.stringify({ ok: true, total: cols.length });
  })()`);
  console.log('点击章节:', clicked);
  await sleep(4500);
  await shot('read');

  // ---- 4. 设置面板 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(2000);
  await client.evaluate(`(() => {
    const b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(2500);
  await shot('settings');

  client.close();
  console.log(`\n全部完成，输出目录: ${outDir}`);
}

main().catch(e => {
  console.error('截图失败:', e.message);
  process.exit(1);
});
