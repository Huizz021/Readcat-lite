/**
 * 临时诊断：定位「下一页内容漏进可视区」的成因。
 * 量出舞台 padding 盒 / 内容盒 / 正文元素 三者的实际边界，
 * 以及翻页后元素的位移是否与页宽严格相等。
 * 用法：node scripts/epub-parser-test/measure-overflow.mjs
 */
import { connectPage } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  const client = await connectPage();
  await client.send('Page.bringToFront').catch(() => { });

  // 确保对开开启
  await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.settingsStore.getAll()) || [];
    var rec = all[0];
    if (rec && rec.settings && rec.settings.options) {
      rec.settings.options.enableTwoPageSpread = true;
      await GLOBAL_DB.store.settingsStore.put(rec);
    }
    return true;
  })()`);
  await sleep(1500);

  const target = JSON.parse(await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    var b = all.find(x => x.type === 'text' && (x.chapterList || []).length > 1);
    return JSON.stringify(b ? { name: b.bookname, pid: b.pid, url: b.detailPageUrl } : { err: 'no text book' });
  })()`));
  if (target.err) { console.log('无文本类书籍'); client.close(); return; }

  await client.evaluate(`(async () => {
    var all = await GLOBAL_DB.store.bookshelfStore.getAll();
    var b = all.find(x => x.bookname === ${JSON.stringify(target.name)});
    location.hash = '#/detail?pid=' + encodeURIComponent(b.pid) + '&detailUrl=' + encodeURIComponent(b.detailPageUrl);
    return true;
  })()`);
  await sleep(3500);
  await client.evaluate(`(() => {
    var cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    var t = cols.find(c => c.querySelector('[data-index="0"]'));
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(7000);

  const geo = async () => JSON.parse(await client.evaluate(`(() => {
    var el = document.getElementById('text-content');
    var stage = document.querySelector('.reader-stage');
    if (!el || !stage) return JSON.stringify({ err: 'not open' });
    var sr = stage.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var scs = getComputedStyle(stage);
    var pl = parseFloat(scs.paddingLeft) || 0;
    var pr = parseFloat(scs.paddingRight) || 0;
    var ecs = getComputedStyle(el);
    var gap = parseFloat(ecs.columnGap) || 0;
    // 内容盒左右边界
    var contentLeft = sr.left + pl;
    var contentRight = sr.right - pr;
    var colW = (el.clientWidth - gap) / 2;
    // 找出所有文本块，标记哪些落在内容盒之外（右侧 padding 区）
    var outside = [];
    [].forEach.call(document.querySelectorAll('#text-content > div[data-index]'), function (d, i) {
      var r = d.getBoundingClientRect();
      if (r.width > 0 && r.left >= contentRight - 1 && r.left < sr.right + 1) {
        outside.push({ i: i, left: Math.round(r.left - sr.left), w: Math.round(r.width), text: (d.textContent || '').slice(0, 8) });
      }
    });
    return JSON.stringify({
      stage: { left: Math.round(sr.left), right: Math.round(sr.right), w: Math.round(sr.width) },
      padding: { left: pl, right: pr },
      contentBox: { left: Math.round(contentLeft), right: Math.round(contentRight), w: Math.round(contentRight - contentLeft) },
      el: { left: Math.round(er.left), w: Math.round(er.width), clientW: el.clientWidth, scrollW: el.scrollWidth },
      elLeftVsContentLeft: Math.round(er.left - contentLeft),
      columnCount: ecs.columnCount,
      gap: gap,
      colW: Math.round(colW),
      stepPerPage: Math.round(colW + gap) * 2,
      transform: el.style.transform,
      overflow: scs.overflow,
      outsideBlocksInRightPadding: outside.slice(0, 5),
      outsideCount: outside.length
    });
  })()`));

  console.log('--- 第 1 屏 ---');
  console.log(JSON.stringify(await geo(), null, 1));

  // 翻到第 2 屏再看
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(1500);
  console.log('--- 第 2 屏 ---');
  console.log(JSON.stringify(await geo(), null, 1));

  client.close();
}

main().catch(e => { console.error('诊断异常:', e.message); process.exit(1); });
