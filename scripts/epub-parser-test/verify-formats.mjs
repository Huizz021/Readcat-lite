/**
 * 在真实打包产物里验证 CBR / MOBI / PDF 三种新格式
 *
 * 关注点：
 *   - CBR：WASM 解压是否在渲染进程正常工作（这是最大风险点）
 *   - MOBI：@lingo-reader/mobi-parser 的 browser 构建能否用，书内图片能否入库
 *   - PDF：pdfjs 能否逐页渲染成可显示的图片
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/verify-formats.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const F = path.join(dir, 'fixtures');
const CBR = path.join(F, 'test-comic.cbr');
const MOBI = path.join(F, 'pg1342.mobi');
const PDF = path.join(F, 'sample.pdf');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const closeImportWindow = async (client) => {
  // 不关掉的话 FileDrag 的 :disable="importBooksWindow.isShow()" 会让下一次拖拽直接失效
  await client.evaluate(`(() => {
    const btn = document.querySelector('.import-books-window .close-button');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1200);
};

const dragIn = async (client, filePath) => {
  await closeImportWindow(client);
  // 页面失焦时 Input.dispatchDragEvent 会被忽略，必须先置顶
  await client.send('Page.bringToFront').catch(() => { });
  await sleep(400);
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
  await sleep(9000);
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
};

const importWindowState = async (client) => JSON.parse(await client.evaluate(`(() => {
  const root = document.querySelector('.import-books-window');
  if (!root) return JSON.stringify({ exists: false });
  const val = sel => { const el = root.querySelector(sel); return el ? el.value : null; };
  const img = root.querySelector('.detail img');
  return JSON.stringify({
    exists: true,
    bookname: val('li.bookname input'),
    author: val('li.author input'),
    pageCount: (root.innerText.match(/共(\\d+)章/) || [])[1] || null,
    coverIsDataUrl: img ? String(img.src).startsWith('data:image/') : false,
    rejected: /解析失败|不支持/.test(root.innerText)
  });
})()`));

const clickImportAndClose = async (client) => {
  const ok = await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const t = btns.find(b => b.innerText.trim() === '导入');
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(10000);
  await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const t = btns.find(b => b.innerText.trim() === '导入成功');
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(1500);
  return ok;
};

const dbState = async (client, bookname) => JSON.parse(await client.evaluate(`(async () => {
  const all = await GLOBAL_DB.store.bookshelfStore.getAll();
  const book = (all || []).find(b => b.bookname === ${JSON.stringify(bookname)});
  if (!book) return JSON.stringify({ found: false, total: (all || []).length, names: (all || []).map(b => b.bookname) });
  const list = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(book.pid, book.detailPageUrl)) || [];
  return JSON.stringify({
    found: true,
    type: book.type || 'text',
    chapterCount: book.chapterList.length,
    titles: book.chapterList.slice(0, 4).map(c => c.title),
    storedChapters: list.length,
    firstHasImage: list.length > 0 ? list[0].textContent.some(s => s.includes('<img')) : false,
    firstHasText: list.length > 0 ? list[0].textContent.some(s => s.replace(/<[^>]+>/g, '').trim().length > 20) : false,
    blobInDb: list.some(c => c.textContent.some(s => s.includes('blob:')))
  });
})()`));

const openAndRead = async (client, bookname, chapterIndex = 1) => {
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
    return JSON.stringify({ ok: true });
  })()`));
  await sleep(5000);
  return clicked;
};

const readView = async (client) => JSON.parse(await client.evaluate(`(() => {
  const imgs = document.querySelectorAll('#text-content img');
  const first = imgs[0];
  const text = document.getElementById('text-content') ? document.getElementById('text-content').innerText : '';
  return JSON.stringify({
    images: imgs.length,
    imageLoaded: first ? (first.naturalWidth > 1) : false,
    imageWidth: first ? first.naturalWidth : 0,
    textLength: (text || '').replace(/\\s+/g, '').length,
    hasError: /获取失败|无法读取/.test(text || '')
  });
})()`));

const main = async () => {
  for (const [label, file] of [['CBR', CBR], ['MOBI', MOBI], ['PDF', PDF]]) {
    if (!fs.existsSync(file)) {
      check(`${label} 测试文件存在`, false, `未找到 ${file}`);
    }
  }

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

  /* ---------- CBR ---------- */
  console.log('\n--- CBR（rar 漫画，WASM 解压）---');
  await dragIn(client, CBR);
  const cbrWin = await importWindowState(client);
  check('CBR 导入窗口已弹出且未被拒绝', cbrWin.exists && !cbrWin.rejected, JSON.stringify(cbrWin));
  check('CBR 书名取自 ComicInfo.xml', cbrWin.bookname === 'RAR 测试漫画', `实际: ${JSON.stringify(cbrWin.bookname)}`);
  check('CBR 页数为 5（垃圾条目被忽略）', cbrWin.pageCount === '5', `实际: ${cbrWin.pageCount}`);
  await clickImportAndClose(client);
  const cbrDb = await dbState(client, 'RAR 测试漫画');
  check('CBR 已写入 IndexedDB', cbrDb.found, JSON.stringify(cbrDb));
  check('CBR 章节数为 5', cbrDb.chapterCount === 5, JSON.stringify(cbrDb));
  check('CBR 每章含图片', cbrDb.firstHasImage === true, JSON.stringify(cbrDb));
  const cbrRead = await openAndRead(client, 'RAR 测试漫画', 1);
  check('CBR 阅读页可打开', cbrRead.ok === true, JSON.stringify(cbrRead));
  const cbrView = await readView(client);
  check('CBR 页面图片已解码渲染', cbrView.images >= 1 && cbrView.imageLoaded, JSON.stringify(cbrView));

  /* ---------- MOBI ---------- */
  console.log('\n--- MOBI（Kindle 格式）---');
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1200);
  await dragIn(client, MOBI);
  const mobiWin = await importWindowState(client);
  check('MOBI 导入窗口已弹出且未被拒绝', mobiWin.exists && !mobiWin.rejected, JSON.stringify(mobiWin));
  check('MOBI 书名从元数据解析', typeof mobiWin.bookname === 'string' && mobiWin.bookname.includes('Pride'), `实际: ${JSON.stringify(mobiWin.bookname)}`);
  check('MOBI 解析出章节', mobiWin.pageCount !== null && Number(mobiWin.pageCount) > 1, `实际: ${mobiWin.pageCount}`);
  await clickImportAndClose(client);
  const mobiName = mobiWin.bookname;
  const mobiDb = await dbState(client, mobiName);
  check('MOBI 已写入 IndexedDB', mobiDb.found, JSON.stringify(mobiDb));
  check('MOBI 章节已落库', mobiDb.storedChapters > 1, JSON.stringify(mobiDb));
  check('MOBI 章节含正文文字', mobiDb.firstHasText === true, JSON.stringify(mobiDb));
  check('MOBI 入库内容不含 blob 地址（否则重启后图片全裂）', mobiDb.blobInDb === false, JSON.stringify(mobiDb));
  const mobiRead = await openAndRead(client, mobiName, 1);
  check('MOBI 阅读页可打开', mobiRead.ok === true, JSON.stringify(mobiRead));
  const mobiView = await readView(client);
  check('MOBI 阅读页渲染出文字', mobiView.textLength > 50 && !mobiView.hasError, JSON.stringify(mobiView));

  /* ---------- PDF ---------- */
  console.log('\n--- PDF（按页渲染）---');
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1200);
  await dragIn(client, PDF);
  const pdfWin = await importWindowState(client);
  check('PDF 导入窗口已弹出且未被拒绝', pdfWin.exists && !pdfWin.rejected, JSON.stringify(pdfWin));
  check('PDF 解析出页面', pdfWin.pageCount !== null && Number(pdfWin.pageCount) >= 1, `实际: ${pdfWin.pageCount}`);
  await clickImportAndClose(client);
  const pdfName = pdfWin.bookname;
  const pdfDb = await dbState(client, pdfName);
  check('PDF 已写入 IndexedDB', pdfDb.found, JSON.stringify(pdfDb));
  check('PDF 页面已落库', pdfDb.storedChapters >= 1, JSON.stringify(pdfDb));
  check('PDF 每页为图片', pdfDb.firstHasImage === true, JSON.stringify(pdfDb));
  const pdfRead = await openAndRead(client, pdfName, 0);
  check('PDF 阅读页可打开', pdfRead.ok === true, JSON.stringify(pdfRead));
  const pdfView = await readView(client);
  check('PDF 页面图片已解码渲染', pdfView.images >= 1 && pdfView.imageLoaded, JSON.stringify(pdfView));

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证过程异常:', e.message);
  process.exit(2);
});
