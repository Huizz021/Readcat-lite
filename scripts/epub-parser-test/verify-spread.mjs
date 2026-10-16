/**
 * 在真实打包产物里验证「双页对开」阅读模式
 *
 * 覆盖两类书籍：
 *   - 漫画（CBZ）：一页一章，双页 = 本页 + 下一页并排，翻页按 2 章推进
 *   - 文本（EPUB）：章节内容按两栏重排，横向翻页
 *
 * 开关通过设置面板点击，验证的是真实用户路径。
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/verify-spread.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const CBZ = path.join(dir, 'fixtures', 'test-comic.cbz');
const EPUB = path.join(dir, 'fixtures', 'pg1342.epub');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dragIn = async (client, filePath) => {
  const size = JSON.parse(await client.evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  const x = Math.floor(size.w / 2);
  const y = Math.floor(size.h / 2);
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
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
  await client.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await sleep(7000);
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
};

const clickImport = async (client) => {
  const ok = await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const t = btns.find(b => b.innerText.trim() === '导入');
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(8000);
  // 点「导入成功」关闭窗口。不关的话 FileDrag 的 :disable 会让下一次拖拽直接失效
  await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const t = btns.find(b => b.innerText.trim() === '导入成功');
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(1500);
  return ok;
};

const openBookReader = async (client, bookname, chapterIndex = 1) => {
  const detailUrl = await client.evaluate(`(async () => {
    const all = await GLOBAL_DB.store.bookshelfStore.getAll();
    const book = (all || []).find(b => b.bookname === ${JSON.stringify(bookname)});
    if (!book) return '';
    location.hash = '#/detail?pid=' + encodeURIComponent(book.pid) + '&detailUrl=' + encodeURIComponent(book.detailPageUrl);
    return book.detailPageUrl;
  })()`);
  if (!detailUrl) {
    return { ok: false, reason: '未取到 detailPageUrl' };
  }
  await sleep(3500);
  const clicked = JSON.parse(await client.evaluate(`(() => {
    const cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    const target = cols.find(c => c.querySelector('[data-index="${chapterIndex}"]'));
    if (!target) return JSON.stringify({ ok: false, total: cols.length });
    target.click();
    return JSON.stringify({ ok: true, total: cols.length });
  })()`));
  await sleep(4500);
  return clicked;
};

/** 读取双页对开的渲染状态 */
const readSpreadState = async (client) => JSON.parse(await client.evaluate(`(() => {
  const stage = document.querySelector('.reader-stage');
  const el = document.getElementById('text-content');
  const pages = [...document.querySelectorAll('.spread-page')];
  return JSON.stringify({
    spread: stage ? stage.classList.contains('spread') : false,
    isComic: el ? el.classList.contains('spread-comic') : false,
    isText: el ? el.classList.contains('spread-text') : false,
    columnWidth: el ? (el.style.columnWidth || '') : '',
    scrollWidth: el ? el.scrollWidth : 0,
    viewportWidth: el && el.parentElement ? el.parentElement.clientWidth : 0,
    transform: el ? (el.style.transform || '') : '',
    pageCount: pages.length,
    pageImages: pages.map(p => p.querySelectorAll('img').length),
    hash: location.hash
  });
})()`));

const main = async () => {
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

  // ---- 1. 导入漫画与电子书 ----
  await dragIn(client, CBZ);
  check('漫画导入窗口已弹出', !!(await client.evaluate(`!!document.querySelector('.import-books-window')`)));
  await clickImport(client);

  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1200);
  await dragIn(client, EPUB);
  await clickImport(client);

  const has = JSON.parse(await client.evaluate(`(async () => {
    const all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    return JSON.stringify({
      comic: all.some(b => b.bookname === '测试漫画系列'),
      epub: all.some(b => b.bookname === 'Pride and Prejudice')
    });
  })()`));
  check('漫画与电子书均已入库', has.comic && has.epub, JSON.stringify(has));

  // ---- 2. 通过设置面板打开「双页对开」 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
  await client.evaluate(`(() => { const b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  const toggled = JSON.parse(await client.evaluate(`(() => {
    const all = [...document.querySelectorAll('*')];
    const row = all.find(e => e.querySelector && e.querySelector('.el-switch') && /双页对开/.test(e.textContent || '') && (e.textContent || '').length < 60);
    if (!row) return JSON.stringify({ ok: false });
    const sw = row.querySelector('.el-switch');
    const wasChecked = sw.classList.contains('is-checked');
    if (!wasChecked) sw.click();
    return JSON.stringify({ ok: true, wasChecked });
  })()`));
  check('设置面板中存在「双页对开」开关', toggled.ok === true, JSON.stringify(toggled));
  await sleep(1200);
  await client.evaluate(`(() => { const b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(1500);

  // ---- 3. 漫画双页 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
  const opened = await openBookReader(client, '测试漫画系列', 0);
  check('漫画可打开阅读页', opened.ok === true, JSON.stringify(opened));

  const cb = await readSpreadState(client);
  check('漫画进入双页对开模式', cb.spread && cb.isComic, JSON.stringify(cb));
  check('左右各一页（两个 spread-page）', cb.pageCount === 2, JSON.stringify(cb));
  check('两页都渲染出图片', cb.pageImages.length === 2 && cb.pageImages[0] >= 1 && cb.pageImages[1] >= 1, JSON.stringify(cb.pageImages));

  const beforeChapter = await client.evaluate(`(() => {
    const el = document.querySelector('.chapter-list, [class*=chapter]');
    return document.querySelector('.rc-book-title, h4, .title') ? document.querySelector('.rc-book-title, h4, .title').innerText : '';
  })()`);

  // 漫画的双页是并排渲染的，翻页应当前进 2 个章节（一个对开），不做位移
  await client.evaluate(`(() => {
    const nav = document.querySelector('.spread-nav');
    const btns = nav ? [...nav.querySelectorAll('button')] : [];
    if (btns.length > 1) btns[1].click();
    return !!nav;
  })()`);
  await sleep(5000);
  const cb2 = await readSpreadState(client);
  check('漫画翻页后仍保持双页并排', cb2.spread && cb2.isComic && cb2.pageCount === 2, JSON.stringify(cb2));

  const chIdx = await client.evaluate(`(async () => {
    const all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    const book = all.find(b => b.bookname === '测试漫画系列');
    return book ? String(book.readIndex) : '-1';
  })()`);
  check('漫画翻页后 readIndex 前进 2 章', chIdx === '2', `readIndex=${chIdx}`);

  // ---- 4. 文本双栏 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
  const openedEpub = await openBookReader(client, 'Pride and Prejudice', 1);
  check('电子书可打开阅读页', openedEpub.ok === true, JSON.stringify(openedEpub));

  const tx = await readSpreadState(client);
  check('文本进入双栏对开模式', tx.spread && tx.isText, JSON.stringify(tx));
  check('栏宽已按视口计算', tx.columnWidth !== '' && parseFloat(tx.columnWidth) > 100, `columnWidth=${tx.columnWidth}`);
  check('内容宽度大于视口（说明有多栏）', tx.scrollWidth > tx.viewportWidth + 10, `scroll=${tx.scrollWidth}, viewport=${tx.viewportWidth}`);

  await client.evaluate(`(() => {
    const nav = document.querySelector('.spread-nav');
    const btns = nav ? [...nav.querySelectorAll('button')] : [];
    if (btns.length > 1) btns[1].click();
    return !!nav;
  })()`);
  await sleep(3000);
  const tx2 = await readSpreadState(client);
  check('文本翻页后位置发生位移', tx2.transform !== tx.transform && tx2.transform !== '', `${tx.transform} -> ${tx2.transform}`);

  // ---- 5. 关闭开关后回到原有滚动模式 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1200);
  await client.evaluate(`(() => { const b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  await client.evaluate(`(() => {
    const all = [...document.querySelectorAll('*')];
    const row = all.find(e => e.querySelector && e.querySelector('.el-switch') && /双页对开/.test(e.textContent || '') && (e.textContent || '').length < 60);
    const sw = row && row.querySelector('.el-switch');
    if (sw && sw.classList.contains('is-checked')) sw.click();
    return !!sw;
  })()`);
  await sleep(1200);
  await client.evaluate(`(() => { const b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(1500);

  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
  const reopened = await openBookReader(client, 'Pride and Prejudice', 1);
  const off = await readSpreadState(client);
  check('关闭开关后回到普通滚动模式', reopened.ok === true && !off.spread && !off.isText, JSON.stringify(off));

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证过程异常:', e.message);
  process.exit(2);
});
