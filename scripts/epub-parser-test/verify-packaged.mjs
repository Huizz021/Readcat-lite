/**
 * 在**真实打包产物**里跑一遍 epub 导入 + 阅读全流程
 *
 * 做法：通过 CDP 向运行中的应用派发真实的拖拽事件（带文件路径），
 * 让应用自己走「拖入 → 解析 → 导入窗口 → 写入 IndexedDB → 详情页 → 阅读页渲染」整条链路。
 *
 * 前提：
 *   1. 应用已用 --remote-debugging-port=9222 启动
 *   2. 待测 epub 已放在磁盘上（默认取 fixtures/pg1342.epub）
 *
 * 用法：node scripts/epub-parser-test/verify-packaged.mjs [epub路径]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const epubPath = path.resolve(process.argv[2] || path.join(dir, 'fixtures', 'pg1342.epub'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 回到书架页 */
const gotoBookshelf = async (client) => {
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
}

/** 进入详情页并点击指定序号的章节 */
const openChapter = async (client, bookname, chapterIndex) => {
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
}

const main = async () => {
  if (!fs.existsSync(epubPath)) {
    console.error(`未找到 epub 文件: ${epubPath}`);
    process.exit(2);
  }
  console.log(`待导入文件: ${epubPath} (${(fs.statSync(epubPath).size / 1024).toFixed(0)} KB)\n`);

  const client = await connectPage();

  // ---- 0. 清空既有数据，保证从干净状态开始 ----
  const cleaned = await client.evaluate(`(async () => {
    const books = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    for (const b of books) { await GLOBAL_DB.store.bookshelfStore.remove(b.id); }
    const texts = (await GLOBAL_DB.store.textContentStore.getAll()) || [];
    for (const t of texts) { await GLOBAL_DB.store.textContentStore.remove(t.id); }
    return JSON.stringify({ books: books.length, texts: texts.length });
  })()`);
  console.log(`已清空既有数据: ${cleaned}\n`);

  // ---- 1. 书架页 ----
  await gotoBookshelf(client);
  const pageInfo = JSON.parse(await client.evaluate(`JSON.stringify({ hash: location.hash, title: document.title, hasImportButton: [...document.querySelectorAll('button')].some(b => b.innerText.includes('导入')) })`));
  check('已进入书架页', pageInfo.hash === '#/bookshelf', `实际: ${pageInfo.hash}`);
  check('「导入」按钮已渲染', pageInfo.hasImportButton, JSON.stringify(pageInfo));

  // ---- 2. 派发真实拖拽事件（带磁盘文件路径）----
  const size = JSON.parse(await client.evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  const x = Math.floor(size.w / 2);
  const y = Math.floor(size.h / 2);
  const data = { items: [], files: [epubPath], dragOperationsMask: 1 };
  const layerDisplay = async () => await client.evaluate(`document.querySelector('.file-drag-container') ? getComputedStyle(document.querySelector('.file-drag-container')).display : 'none'`);
  // 上一轮若留下未结束的拖拽会话，新的 dragEnter 会被 Chromium 忽略，先复位
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
  await sleep(300);
  let dragging = 'none';
  for (let i = 0; i < 5 && dragging === 'none'; i++) {
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await sleep(700);
    dragging = await layerDisplay();
  }
  check('拖拽提示层已显示', dragging !== 'none', `display: ${dragging}`);
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await sleep(300);
  await client.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await sleep(7000);
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });

  // ---- 3. 导入窗口的解析结果 ----
  const win = JSON.parse(await client.evaluate(`(() => {
    const root = document.querySelector('.import-books-window');
    if (!root) return JSON.stringify({ exists: false });
    const val = sel => { const el = root.querySelector(sel); return el ? el.value : null; };
    const img = root.querySelector('.detail img');
    return JSON.stringify({
      exists: true,
      bookname: val('li.bookname input'),
      author: val('li.author input'),
      intro: val('li.intro textarea'),
      chapterCount: (root.innerText.match(/共(\\d+)章/) || [])[1] || null,
      coverWidth: img ? img.naturalWidth : 0,
      coverIsDataUrl: img ? String(img.src).startsWith('data:image/') : false,
      chapterPreview: [...root.querySelectorAll('.chapter-list li')].map(li => li.innerText.trim()).slice(0, 3)
    });
  })()`));
  check('导入窗口已弹出', win.exists, JSON.stringify(win));
  check('书名解析正确', win.bookname === 'Pride and Prejudice', `实际: ${JSON.stringify(win.bookname)}`);
  check('作者解析正确', win.author === 'Jane Austen', `实际: ${JSON.stringify(win.author)}`);
  check('简介字段可读取（pg1342 本身无 dc:description，允许为空）', typeof win.intro === 'string', `类型: ${typeof win.intro}, 值: ${JSON.stringify(win.intro)}`);
  check('章节数正确（17 章）', win.chapterCount === '17', `实际: ${win.chapterCount}`);
  check('封面为 epub 自带图片', win.coverIsDataUrl && win.coverWidth > 1, `dataUrl=${win.coverIsDataUrl}, 宽度=${win.coverWidth}`);
  check('章节标题预览正常', win.chapterPreview.length === 3 && win.chapterPreview.every(v => v.length > 0), JSON.stringify(win.chapterPreview));

  // ---- 4. 点击「导入」----
  const clickedImport = await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const target = btns.find(b => b.innerText.trim() === '导入');
    if (target) target.click();
    return !!target;
  })()`);
  check('已点击「导入」', clickedImport === true, `实际: ${clickedImport}`);
  await sleep(10000);

  // ---- 5. IndexedDB 落库结果 ----
  const db = JSON.parse(await client.evaluate(`(async () => {
    const all = await GLOBAL_DB.store.bookshelfStore.getAll();
    const book = (all || []).find(b => b.bookname === 'Pride and Prejudice');
    if (!book) return JSON.stringify({ found: false, total: (all || []).length });
    const list = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(book.pid, book.detailPageUrl)) || [];
    const blocks = list.reduce((prev, curr) => prev + curr.textContent.length, 0);
    const withImage = list.reduce((prev, curr) => prev + curr.textContent.filter(t => t.includes('<img')).length, 0);
    const withBr = list.reduce((prev, curr) => prev + curr.textContent.filter(t => t.includes('<br/>')).length, 0);
    return JSON.stringify({
      found: true,
      pid: book.pid,
      chapterCount: book.chapterList.length,
      storedChapters: list.length,
      coverIsDataUrl: typeof book.coverImageUrl === 'string' && book.coverImageUrl.startsWith('data:image/'),
      blocks,
      blocksWithImage: withImage,
      blocksWithBr: withBr
    });
  })()`));
  check('书籍已写入 IndexedDB', db.found, JSON.stringify(db));
  check('章节列表完整落库', db.chapterCount === 17 && db.storedChapters === 17, JSON.stringify(db));
  check('封面以 data URL 存储', db.coverIsDataUrl, JSON.stringify(db));
  check('正文段落已落库', db.blocks > 100, `段落数: ${db.blocks}`);
  check('章节内含图片段落', db.blocksWithImage > 0, `含图段落数: ${db.blocksWithImage}`);
  check('含 <br/> 换行的段落已保留', db.blocksWithBr > 0, `含换行段落数: ${db.blocksWithBr}`);

  // ---- 6. 详情页 → 点击正文章节 → 阅读页 ----
  const textClick = await openChapter(client, 'Pride and Prejudice', 1);
  check('详情页章节列表可点击', textClick.ok === true, JSON.stringify(textClick));
  const readText = JSON.parse(await client.evaluate(`JSON.stringify({
    hash: location.hash,
    paragraphs: document.querySelectorAll('#text-content > div[data-index]').length,
    textLength: document.querySelector('#text-content') ? document.querySelector('#text-content').innerText.length : 0,
    hasError: document.querySelector('#text-content') ? document.querySelector('#text-content').innerText.includes('正文获取失败') : true
  })`));
  check('阅读页渲染出正文段落', readText.paragraphs > 100, JSON.stringify(readText));
  check('阅读页有实际文字', readText.textLength > 2000, JSON.stringify(readText));
  check('阅读页未出现获取失败提示', readText.hasError === false, JSON.stringify(readText));

  // ---- 7. 回到详情页 → 点击封面页章节（含插图）----
  const coverClick = await openChapter(client, 'Pride and Prejudice', 0);
  check('封面页章节可点击', coverClick.ok === true, JSON.stringify(coverClick));
  const readImg = JSON.parse(await client.evaluate(`JSON.stringify({
    paragraphs: document.querySelectorAll('#text-content > div[data-index]').length,
    images: document.querySelectorAll('#text-content img').length,
    imageLoaded: [...document.querySelectorAll('#text-content img')].some(i => i.naturalWidth > 1),
    imageWidth: (document.querySelector('#text-content img') || {}).naturalWidth || 0
  })`));
  check('阅读页渲染出段落', readImg.paragraphs > 0, JSON.stringify(readImg));
  check('阅读页渲染出插图', readImg.images > 0, JSON.stringify(readImg));
  check('插图实际解码成功', readImg.imageLoaded, JSON.stringify(readImg));

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证过程异常:', e.message);
  process.exit(2);
});
