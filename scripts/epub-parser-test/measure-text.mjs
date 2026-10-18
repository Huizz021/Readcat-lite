/**
 * 临时诊断：量出「文本双栏对开」的实际渲染状态。
 * 走可靠路径：拖入真实 EPUB（文本类）→ 设置面板开对开 → 详情页进章节 → 量尺寸。
 * 用法：node scripts/epub-parser-test/measure-text.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EPUB = path.join(dir, 'fixtures', 'pg1342.epub');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const closeImportWindow = async (client) => {
  await client.evaluate(`(() => { var b = document.querySelector('.import-books-window .close-button'); if (b) b.click(); return !!b; })()`);
  await sleep(1000);
};

const dragIn = async (client, filePath) => {
  await closeImportWindow(client);
  await client.send('Page.bringToFront').catch(() => { });
  await sleep(400);
  const size = JSON.parse(await client.evaluate(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  const x = Math.floor(size.w / 2), y = Math.floor(size.h / 2);
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
  await sleep(300);
  for (let i = 0; i < 6; i++) {
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await sleep(700);
    const d = await client.evaluate(`document.querySelector('.file-drag-container') ? getComputedStyle(document.querySelector('.file-drag-container')).display : 'none'`);
    if (d !== 'none') break;
  }
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await sleep(300);
  await client.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await sleep(9000);
  await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x, y, data }).catch(() => { });
};

const setSpread = async (client, on) => {
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1500);
  await client.evaluate(`(() => { var b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(2200);
  const r = await client.evaluate(`(() => {
    var row = [...document.querySelectorAll('*')].find(e => e.querySelector && e.querySelector('.el-switch') && /双页对开/.test(e.textContent || '') && (e.textContent || '').length < 60);
    var sw = row && row.querySelector('.el-switch');
    if (!sw) return JSON.stringify({ ok: false });
    var checked = sw.classList.contains('is-checked');
    if (checked !== ${on}) sw.click();
    return JSON.stringify({ ok: true, was: checked });
  })()`);
  await sleep(1000);
  await client.evaluate(`(() => { var b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
  return JSON.parse(r);
};

const main = async () => {
  const client = await connectPage();
  await client.send('Page.bringToFront').catch(() => { });

  // 直接用书架上已有的文本类书籍（真实数据，最贴合实际场景）
  const target = JSON.parse(await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    var b = all.find(x => x.type === 'text' && (x.chapterList || []).length > 1);
    return JSON.stringify(b ? { name: b.bookname, chapters: b.chapterList.length } : { err: 'no text book' });
  })()`));
  console.log('目标书籍:', target);
  if (target.err) {
    client.close();
    return;
  }

  console.log('开启对开:', JSON.stringify(await setSpread(client, true)));

  // 进详情页 → 点第一个章节
  await client.evaluate(`(async () => {
    var all = await GLOBAL_DB.store.bookshelfStore.getAll();
    var b = all.find(x => x.type === 'text' && (x.chapterList || []).length > 1);
    location.hash = '#/detail?pid=' + encodeURIComponent(b.pid) + '&detailUrl=' + encodeURIComponent(b.detailPageUrl);
    return true;
  })()`);
  await sleep(3500);
  const clicked = await client.evaluate(`(() => {
    var cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    var t = cols.find(c => c.querySelector('[data-index="1"]'));
    if (t) t.click();
    return !!t;
  })()`);
  console.log('点击章节:', clicked);
  await sleep(6000);

  const report = JSON.parse(await client.evaluate(`(() => {
    var out = {};
    var el = document.getElementById('text-content');
    var stage = document.querySelector('.reader-stage');
    if (!el || !stage) return JSON.stringify({ err: 'reader not open', hash: location.hash });
    var cs = getComputedStyle(el);
    var scs = getComputedStyle(stage);
    out.stageW = stage.clientWidth;
    out.stageH = stage.clientHeight;
    out.elW = el.clientWidth;
    out.inlineWidth = el.style.width;
    out.columnCount = cs.columnCount;
    out.columnWidth = cs.columnWidth;
    out.columnGap = cs.columnGap;
    out.columnFill = cs.columnFill;
    out.scrollWidth = el.scrollWidth;
    out.transform = el.style.transform;
    out.spreadClass = el.className;
    out.navExists = !!document.querySelector('.spread-nav');
    var nav = document.querySelector('.spread-nav span');
    out.navLabel = nav ? nav.textContent : '';
    out.pageCount = stage.clientWidth > 0 ? Math.round(el.scrollWidth / stage.clientWidth) : 0;
    out.widthMatchesStage = Math.abs(el.clientWidth - stage.clientWidth) <= 2;
    var gap = parseFloat(cs.columnGap) || 0;
    out.expectedColumn = Math.round((stage.clientWidth - gap) / 2);
    out.actualColumn = Math.round((el.clientWidth - gap) / 2);
    out.columnsFitExactly = Math.abs(out.expectedColumn - out.actualColumn) <= 2;
    out.stageOverflow = scs.overflow;
    return JSON.stringify(out);
  })()`));
  console.log(JSON.stringify(report, null, 1));

  client.close();
}

main().catch(e => { console.error('诊断异常:', e.message); process.exit(1); });
