/**
 * 验证本轮四项改动：
 *   1. 页边距（正文不贴边）
 *   2. 左右方向键翻页（走全局快捷键）
 *   3. 滚轮翻页
 *   4. 快捷键默认值迁移
 * 用法：node scripts/epub-parser-test/verify-read-ux.mjs
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

  // 等设置写回（debounce 5s）
  await sleep(8000);
  const sk = JSON.parse(await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.settingsStore.getAll()) || [];
    var rec = all[0];
    if (!rec || !rec.settings) return JSON.stringify({ err: 'no-settings' });
    var s = rec.settings.shortcutKey || {};
    return JSON.stringify({ nextPage: s.nextPage, prevPage: s.prevPage, nextChapter: s.nextChapter, prevChapter: s.prevChapter });
  })()`));
  check('快捷键默认值已迁移（←/→ 翻页，Alt+←/→ 切章）',
    sk.nextPage === '→' && sk.prevPage === '←' && sk.nextChapter === 'Alt+→' && sk.prevChapter === 'Alt+←',
    JSON.stringify(sk));

  // 打开一本文本类书籍并确保对开开启
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

  // 1. 页边距
  const geo = JSON.parse(await client.evaluate(`(() => {
    var el = document.getElementById('text-content');
    var stage = document.querySelector('.reader-stage');
    if (!el || !stage) return JSON.stringify({ err: 'not open' });
    var sr = stage.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var firstBlock = document.querySelector('#text-content > div[data-index]:nth-child(2)');
    var fr = firstBlock ? firstBlock.getBoundingClientRect() : null;
    return JSON.stringify({
      stageW: Math.round(sr.width),
      elW: Math.round(er.width),
      leftInset: Math.round(er.x - sr.x),
      rightInset: Math.round(sr.x + sr.width - (er.x + er.width)),
      paddingLeft: getComputedStyle(stage).paddingLeft,
      firstTextX: fr ? Math.round(fr.x - sr.x) : null,
      navLabel: (document.querySelector('.spread-nav span') || {}).textContent || ''
    });
  })()`));
  check('正文左右留有页边距（不贴边）',
    geo.leftInset >= 20 && geo.rightInset >= 20,
    JSON.stringify(geo));
  console.log('   页面几何:', JSON.stringify(geo));

  // 2. 方向键翻页（严格判据：只换屏，不换章）
  const stateOf = async () => JSON.parse(await client.evaluate(`(async () => {
    var all = (await GLOBAL_DB.store.bookshelfStore.getAll()) || [];
    var b = all.find(x => x.bookname === ${JSON.stringify(target.name)});
    return JSON.stringify({
      label: (document.querySelector('.spread-nav span') || {}).textContent || '',
      chapter: b ? b.readIndex : -1,
      transform: (document.getElementById('text-content') || {}).style.transform || ''
    });
  })()`));
  const s0 = await stateOf();
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(1500);
  const s1 = await stateOf();
  check('按 → 换到下一屏且章节不变', s1.label !== s0.label && s1.chapter === s0.chapter,
    `${s0.label}(ch${s0.chapter}) -> ${s1.label}(ch${s1.chapter})`);

  // 3. 滚轮翻页
  await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 400, deltaX: 0, deltaY: 120 });
  await sleep(1500);
  const s2 = await stateOf();
  check('滚轮向下换到下一屏且章节不变', s2.label !== s1.label && s2.chapter === s1.chapter,
    `${s1.label}(ch${s1.chapter}) -> ${s2.label}(ch${s2.chapter})`);

  // 4. 滚轮向上翻回
  await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 400, deltaX: 0, deltaY: -120 });
  await sleep(1500);
  const s3 = await stateOf();
  check('滚轮向上翻回上一屏', s3.label === s1.label, `${s2.label} -> ${s3.label}`);

  // 5. 方向键向左翻回
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
  await sleep(1500);
  const s4 = await stateOf();
  check('按 ← 翻回上一屏且章节不变', s4.label === s0.label && s4.chapter === s0.chapter,
    `${s3.label}(ch${s3.chapter}) -> ${s4.label}(ch${s4.chapter})`);

  // 6. Alt+→ 切下一章
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, modifiers: 1 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, modifiers: 1 });
  await sleep(3000);
  const s5 = await stateOf();
  check('Alt+→ 切换章节', s5.chapter !== s0.chapter, `ch${s0.chapter} -> ch${s5.chapter}`);

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('验证异常:', e.message); process.exit(2); });
