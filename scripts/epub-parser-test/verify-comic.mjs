/**
 * 在真实打包产物里验证 CBZ 漫画支持
 *
 * 核心验证点：页面顺序。
 * 测试文件里每页 PNG 尺寸不同（page1=10px, page2=20px, page10=30px, ...），
 * 如果按字符串排序，page10 会排到 page2 前面，第 3 页就会是 20px 而不是 30px。
 * 因此读取渲染后图片的 naturalWidth 即可证明自然序是否生效。
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/verify-comic.mjs [cbz路径]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cbzPath = path.resolve(process.argv[2] || path.join(dir, 'fixtures', 'test-comic.cbz'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 进入详情页并点击指定页码（0 基） */
const openPage = async (client, bookname, pageIndex) => {
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
    const target = cols.find(c => c.querySelector('[data-index="${pageIndex}"]'));
    if (!target) return JSON.stringify({ ok: false, total: cols.length });
    target.click();
    return JSON.stringify({ ok: true, total: cols.length });
  })()`));
  await sleep(4000);
  return clicked;
}

/** 读取阅读页里第一张图片的原始宽度 */
const readImageWidth = async (client) => {
  return JSON.parse(await client.evaluate(`JSON.stringify({
    images: document.querySelectorAll('#text-content img').length,
    width: (document.querySelector('#text-content img') || {}).naturalWidth || 0,
    loaded: [...document.querySelectorAll('#text-content img')].some(i => i.naturalWidth > 1)
  })`));
}

const main = async () => {
  if (!fs.existsSync(cbzPath)) {
    console.error(`未找到 CBZ 文件: ${cbzPath}\n请先运行 node scripts/epub-parser-test/gen-cbz.mjs`);
    process.exit(2);
  }
  console.log(`待导入文件: ${cbzPath} (${(fs.statSync(cbzPath).size / 1024).toFixed(1)} KB)\n`);

  const client = await connectPage();

  // ---- 0. 清空既有数据 ----
  const cleaned = await client.evaluate(`(async () => {
    const books = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    for (const b of books) { await GLOBAL_DB.store.bookshelfStore.remove(b.id); }
    const texts = (await GLOBAL_DB.store.textContentStore.getAll()) || [];
    for (const t of texts) { await GLOBAL_DB.store.textContentStore.remove(t.id); }
    return JSON.stringify({ books: books.length, texts: texts.length });
  })()`);
  console.log(`已清空既有数据: ${cleaned}\n`);

  // ---- 1. 回到书架 ----
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);

  // ---- 2. 拖入 CBZ ----
  const size = JSON.parse(await client.evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  const x = Math.floor(size.w / 2);
  const y = Math.floor(size.h / 2);
  const data = { items: [], files: [cbzPath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
  await sleep(300);
  let dragging = 'none';
  for (let i = 0; i < 5 && dragging === 'none'; i++) {
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await sleep(700);
    dragging = await client.evaluate(`document.querySelector('.file-drag-container') ? getComputedStyle(document.querySelector('.file-drag-container')).display : 'none'`);
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
      pageCount: (root.innerText.match(/共(\\d+)章/) || [])[1] || null,
      coverWidth: img ? img.naturalWidth : 0,
      coverIsDataUrl: img ? String(img.src).startsWith('data:image/') : false
    });
  })()`));
  check('导入窗口已弹出', win.exists, JSON.stringify(win));
  check('书名取自 ComicInfo.xml（Series）', win.bookname === '测试漫画系列', `实际: ${JSON.stringify(win.bookname)}`);
  check('作者取自 ComicInfo.xml（Writer）', win.author === '测试作者', `实际: ${JSON.stringify(win.author)}`);
  check('简介取自 ComicInfo.xml（Summary）', typeof win.intro === 'string' && win.intro.includes('合成文件'), `实际: ${JSON.stringify(win.intro)}`);
  check('页数为 5（垃圾条目被忽略）', win.pageCount === '5', `实际: ${win.pageCount}`);
  check('封面为第一页图片（10px 宽）', win.coverIsDataUrl && win.coverWidth === 10, `dataUrl=${win.coverIsDataUrl}, 宽度=${win.coverWidth}`);

  // ---- 4. 点击「导入」----
  const clickedImport = await client.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.import-books-window button')];
    const target = btns.find(b => b.innerText.trim() === '导入');
    if (target) target.click();
    return !!target;
  })()`);
  check('已点击「导入」', clickedImport === true, `实际: ${clickedImport}`);
  await sleep(8000);

  // ---- 5. 落库结果 ----
  const db = JSON.parse(await client.evaluate(`(async () => {
    const all = await GLOBAL_DB.store.bookshelfStore.getAll();
    const book = (all || []).find(b => b.bookname === '测试漫画系列');
    if (!book) return JSON.stringify({ found: false, total: (all || []).length });
    const list = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(book.pid, book.detailPageUrl)) || [];
    return JSON.stringify({
      found: true,
      chapterCount: book.chapterList.length,
      titles: book.chapterList.map(c => c.title),
      storedChapters: list.length,
      eachHasOneImage: list.every(c => c.textContent.length === 1 && c.textContent[0].includes('<img'))
    });
  })()`));
  check('漫画已写入 IndexedDB', db.found, JSON.stringify(db));
  check('章节数 = 5', db.chapterCount === 5, JSON.stringify(db));
  check('章节标题为「第N页」', Array.isArray(db.titles) && db.titles.join(',') === '第1页,第2页,第3页,第4页,第5页', JSON.stringify(db.titles));
  check('每章恰好一张图片', db.eachHasOneImage === true, JSON.stringify(db));

  // ---- 6. 页面顺序（关键验证）----
  const p1 = await openPage(client, '测试漫画系列', 0);
  check('第 1 页可点击打开', p1.ok === true, JSON.stringify(p1));
  const img1 = await readImageWidth(client);
  check('第 1 页渲染出图片', img1.images === 1 && img1.loaded, JSON.stringify(img1));
  check('第 1 页对应 page1.png（10px）', img1.width === 10, JSON.stringify(img1));

  const p3 = await openPage(client, '测试漫画系列', 2);
  check('第 3 页可点击打开', p3.ok === true, JSON.stringify(p3));
  const img3 = await readImageWidth(client);
  check('第 3 页渲染出图片', img3.images === 1 && img3.loaded, JSON.stringify(img3));
  check('第 3 页对应 page10.png（30px）—— 证明自然序生效', img3.width === 30, JSON.stringify(img3));

  const p5 = await openPage(client, '测试漫画系列', 4);
  const img5 = await readImageWidth(client);
  check('第 5 页对应 page20.png（50px）', p5.ok === true && img5.width === 50, JSON.stringify(img5));

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证过程异常:', e.message);
  process.exit(2);
});
