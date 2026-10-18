/**
 * 一次性验证：开启双页对开 → 进入含插图的章节 → 量出排版与中缝。
 * 用法：node scripts/epub-parser-test/verify-image-spread.mjs
 */
import { connectPage } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  const client = await connectPage();
  await client.send('Page.bringToFront').catch(() => { });

  // 1. 通过设置面板开启双页对开（真实用户路径）
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(2000);
  await client.evaluate(`(() => { var b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  const toggle = await client.evaluate(`(() => {
    var row = [...document.querySelectorAll('*')].find(e => e.querySelector && e.querySelector('.el-switch') && /双页对开/.test(e.textContent || '') && (e.textContent || '').length < 60);
    var sw = row && row.querySelector('.el-switch');
    if (!sw) return JSON.stringify({ ok: false });
    var was = sw.classList.contains('is-checked');
    if (!was) sw.click();
    return JSON.stringify({ ok: true, was: was });
  })()`);
  console.log('开关:', toggle);
  await sleep(1200);
  await client.evaluate(`(() => { var b = [...document.querySelectorAll('#header button')].find(x => x.title === '设置'); if (b) b.click(); return !!b; })()`);
  await sleep(1500);

  // 2. 找到含插图的章节并进入
  const info = JSON.parse(await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    for (var b of all) {
      var tcs = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(b.pid, b.detailPageUrl)) || [];
      for (var t of tcs) {
        if ((t.textContent || []).some(function (s) { return s && s.indexOf('<img') >= 0; })) {
          return JSON.stringify({ book: b.bookname, pid: b.pid, url: b.detailPageUrl, idx: t.chapter.index, title: t.chapter.title });
        }
      }
    }
    return JSON.stringify({ err: 'no image chapter' });
  })()`));
  console.log('插图章节:', JSON.stringify(info));
  if (info.err) { client.close(); return; }

  await client.evaluate(`(async () => {
    var all = await GLOBAL_DB.store.bookshelfStore.getAll();
    var b = all.find(x => x.bookname === ${JSON.stringify(info.book)});
    location.hash = '#/detail?pid=' + encodeURIComponent(b.pid) + '&detailUrl=' + encodeURIComponent(b.detailPageUrl);
    return true;
  })()`);
  await sleep(3500);
  const clicked = await client.evaluate(`(() => {
    var cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    var t = cols.find(c => c.querySelector('[data-index="${info.idx}"]'));
    if (t) t.click();
    return !!t;
  })()`);
  console.log('点击章节:', clicked);
  await sleep(7000);

  // 3. 量尺寸
  const r = JSON.parse(await client.evaluate(`(() => {
    var el = document.getElementById('text-content');
    var stage = document.querySelector('.reader-stage');
    if (!el || !stage) return JSON.stringify({ err: 'not open', hash: location.hash });
    var cs = getComputedStyle(el);
    var scs = getComputedStyle(stage);
    var g = getComputedStyle(stage, '::after');
    var gap = parseFloat(cs.columnGap) || 0;
    var colW = (el.clientWidth - gap) / 2;
    var pageH = stage.clientHeight;
    var elRect = el.getBoundingClientRect();
    var imgs = [].map.call(document.querySelectorAll('#text-content img'), function (img, i) {
      var b = img.getBoundingClientRect();
      return {
        i: i,
        rend: Math.round(b.width) + 'x' + Math.round(b.height),
        col: Math.floor((b.x - elRect.x) / (colW + gap)) + 1,
        overW: b.width > colW + 1,
        overH: b.height > pageH + 1,
        maxH: getComputedStyle(img).maxHeight
      };
    });
    return JSON.stringify({
      stage: stage.clientWidth + 'x' + pageH,
      elW: el.clientWidth,
      elH: el.clientHeight,
      widthMatch: Math.abs(el.clientWidth - stage.clientWidth) <= 2,
      columnCount: cs.columnCount,
      gap: gap,
      colW: Math.round(colW),
      overflow: scs.overflow,
      gutterContent: g.content,
      gutterWidth: g.width,
      gutterOpacity: g.opacity,
      navLabel: (document.querySelector('.spread-nav span') || {}).textContent || '',
      pages: Math.round(el.scrollWidth / stage.clientWidth),
      imgCount: imgs.length,
      allImgsWithinPage: imgs.every(function (x) { return !x.overW && !x.overH; }),
      sample: imgs.slice(0, 5)
    });
  })()`));
  console.log(JSON.stringify(r, null, 1));

  client.close();
}

main().catch(e => { console.error('验证异常:', e.message); process.exit(1); });
