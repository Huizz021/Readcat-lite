/**
 * 验证本轮两项改动：
 *   1. 翻页位移严格等于「元素宽 + 栏间距」（否则下一页内容会从右边漏进来）
 *   2. 本章最后一屏再按下一页 → 自动进入下一章第一屏
 * 用法：node scripts/epub-parser-test/verify-page-step.mjs
 */
import { connectPage } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
};

const main = async () => {
  const client = await connectPage();
  await client.send('Page.bringToFront').catch(() => { });

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
  if (target.err) { check('存在文本类书籍', false, JSON.stringify(target)); client.close(); return; }

  // 从第 1 章进入
  await client.evaluate(`(async () => {
    var all = await GLOBAL_DB.store.bookshelfStore.getAll();
    var b = all.find(x => x.bookname === ${JSON.stringify(target.name)});
    location.hash = '#/detail?pid=' + encodeURIComponent(b.pid) + '&detailUrl=' + encodeURIComponent(b.detailPageUrl);
    return true;
  })()`);
  await sleep(3500);
  await client.evaluate(`(() => {
    var cols = [...document.querySelectorAll('.chapter .list .rc-button')];
    var t = cols.find(c => c.querySelector('[data-index="1"]'));
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(7000);

  const state = async () => JSON.parse(await client.evaluate(`(async () => {
    var el = document.getElementById('text-content');
    var all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    var b = all.find(x => x.bookname === ${JSON.stringify(target.name)});
    if (!el) return JSON.stringify({ err: 'not open' });
    var gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    var step = el.clientWidth + gap;
    var m = (el.style.transform || '').match(/translateX\\((-?[\\d.]+)px\\)/);
    var tx = m ? Math.abs(parseFloat(m[1])) : 0;
    return JSON.stringify({
      label: (document.querySelector('.spread-nav span') || {}).textContent || '',
      chapter: b ? b.readIndex : -1,
      elW: el.clientWidth,
      gap: gap,
      step: step,
      tx: Math.round(tx),
      txModStep: Math.round(tx % step),
      pages: Math.round(el.scrollWidth / step)
    });
  })()`));

  const s0 = await state();
  console.log('初始:', JSON.stringify(s0));

  // 翻一屏，检查位移是否等于 step
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(1500);
  const s1 = await state();
  check('第 2 屏位移 = 元素宽 + 栏间距（无残留漏页）',
    Math.abs(s1.tx - s1.step) <= 1,
    `tx=${s1.tx}, step=${s1.step}, elW=${s1.elW}, gap=${s1.gap}`);

  // 连翻到本章最后一屏
  let guard = 0;
  let cur = s1;
  while (guard++ < 40) {
    const pageIdx = Math.round(cur.tx / cur.step);
    if (pageIdx >= cur.pages - 1) break;
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
    await sleep(900);
    cur = await state();
  }
  console.log('末屏:', JSON.stringify(cur));
  check('已到达本章最后一屏', Math.round(cur.tx / cur.step) >= cur.pages - 1, JSON.stringify(cur));

  // 再按一次 → 应该自动进入下一章第一屏
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(4000);
  const s2 = await state();
  console.log('跨章后:', JSON.stringify(s2));
  check('末屏按下一页自动进入下一章', s2.chapter > cur.chapter, `ch${cur.chapter} -> ch${s2.chapter}`);
  check('跨章后停在新章第一屏', Math.round(s2.tx) === 0, `tx=${s2.tx}`);

  // 反向：第一屏按 ← 应回到上一章最后一屏
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await sleep(4000);
  const s3 = await state();
  console.log('反向跨章后:', JSON.stringify(s3));
  check('第一屏按上一页回到上一章', s3.chapter < s2.chapter, `ch${s2.chapter} -> ch${s3.chapter}`);
  check('回到上一章的最后一屏', Math.round(s3.tx / s3.step) >= s3.pages - 1, `tx=${s3.tx}, step=${s3.step}, pages=${s3.pages}`);

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('验证异常:', e.message); process.exit(2); });
