/**
 * 验证「书城」功能已彻底移除、且其余功能未受影响
 *
 * 前提：应用已用 --remote-debugging-port=9222 启动
 * 用法：node scripts/epub-parser-test/verify-no-bookstore.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}${ok ? '' : `\n        ${detail}`}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  const client = await connectPage();
  const goto = async (hash, wait = 1400) => {
    await client.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(wait);
    return await client.evaluate(`location.hash`);
  };

  // ---- 1. 默认入口 ----
  await client.evaluate(`location.hash = ''`);
  await client.evaluate(`location.reload()`);
  await sleep(3000);
  const boot = JSON.parse(await client.evaluate(`JSON.stringify({ hash: location.hash, title: document.title })`));
  check('启动后默认进入书架（不再重定向到书城）', boot.hash === '#/bookshelf', JSON.stringify(boot));
  check('窗口标题为「书架 | ReadCat Lite」', boot.title === '书架 | ReadCat Lite', JSON.stringify(boot));

  // ---- 2. 书城入口已消失 ----
  const header = JSON.parse(await client.evaluate(`JSON.stringify({
    headerText: (document.querySelector('#header') || {}).innerText || '',
    hasNavigation: !!document.querySelector('.navigation'),
    headerChildren: document.querySelector('#header .left-box') ? document.querySelector('#header .left-box').children.length : -1
  })`));
  check('顶部导航中不再出现「书城」', !header.headerText.includes('书城'), JSON.stringify(header));
  check('顶部导航中仍保留「书架」相关功能', header.headerText.length > 0, JSON.stringify(header));
  check('Navigation 组件已移除', header.hasNavigation === false, JSON.stringify(header));

  // ---- 3. 旧路径与未知路径兜底 ----
  const bookstoreHash = await goto('#/bookstore');
  check('/bookstore 回落到书架（不再白屏）', bookstoreHash === '#/bookshelf', `实际: ${bookstoreHash}`);
  const unknownHash = await goto('#/不存在的页面');
  check('未知路径回落到书架', unknownHash === '#/bookshelf', `实际: ${unknownHash}`);

  // ---- 4. 其余页面仍可访问 ----
  const shelf = JSON.parse(await client.evaluate(`JSON.stringify({
    hash: location.hash,
    hasImport: [...document.querySelectorAll('button')].some(b => b.innerText.includes('导入')),
    hasSearchEntry: !!document.querySelector('#header .center-box #search')
  })`));
  check('书架页正常渲染（导入按钮在）', shelf.hasImport, JSON.stringify(shelf));
  check('顶栏搜索入口仍在', shelf.hasSearchEntry, JSON.stringify(shelf));

  // 搜索输入框在弹出窗口里，点顶栏入口才会出现
  const searchPopup = JSON.parse(await client.evaluate(`(async () => {
    const entry = document.querySelector('#header .center-box #search');
    if (entry) entry.click();
    await new Promise(r => setTimeout(r, 1300));
    return JSON.stringify({ inputs: document.querySelectorAll('input').length });
  })()`));
  check('点击搜索入口可弹出搜索框', searchPopup.inputs > 0, JSON.stringify(searchPopup));

  const searchHash = await goto('#/search', 2000);
  check('搜索页可打开', searchHash === '#/search', `实际: ${searchHash}`);
  const historyHash = await goto('#/history', 1600);
  check('历史记录页可打开', historyHash === '#/history', `实际: ${historyHash}`);

  // ---- 5. 插件体系仍正常（未因删除类型而报错）----
  const pluginState = JSON.parse(await client.evaluate(`(async () => {
    const all = GLOBAL_PLUGINS.getAllPlugins();
    return JSON.stringify({
      total: all.length,
      types: [...new Set(all.map(p => p.pluginClass.TYPE))],
      labels: all.map(p => p.pluginClass.NAME).slice(0, 10)
    });
  })()`));
  check('插件池可正常读取（未因删除类型而报错）', typeof pluginState.total === 'number', JSON.stringify(pluginState));

  // ---- 6. 设置面板（不是路由，是工具条弹出的 Window）----
  const settings = JSON.parse(await client.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('#header button')].find(b => b.title === '设置');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 2000));
    const text = document.body.innerText;
    return JSON.stringify({
      clicked: !!btn,
      hasPluginLabel: text.includes('插件'),
      hasReadStyleLabel: text.includes('阅读样式'),
      hasBookStore: text.includes('书城')
    });
  })()`));
  check('设置面板可打开（含「插件」「阅读样式」）', settings.clicked && settings.hasPluginLabel && settings.hasReadStyleLabel, JSON.stringify(settings));
  check('设置面板中不再出现「书城」', settings.hasBookStore === false, JSON.stringify(settings));

  // ---- 7. 截图留档，便于人工核对顶栏布局 ----
  await client.send('Page.enable');
  await client.evaluate(`location.hash = '#/bookshelf'`);
  await sleep(1800);
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(dir, 'screenshot-header.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`\n已保存截图: ${shotPath}`);

  client.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证过程异常:', e.message);
  process.exit(2);
});
