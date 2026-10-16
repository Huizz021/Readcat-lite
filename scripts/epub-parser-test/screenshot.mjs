/**
 * 对当前运行中的应用截图，便于人工核对界面布局
 * 用法：node scripts/epub-parser-test/screenshot.mjs [hash] [输出文件]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPage } from './cdp.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hash = process.argv[2] || '#/bookshelf';
const output = path.resolve(process.argv[3] || path.join(dir, 'screenshot-header.png'));

const main = async () => {
  const client = await connectPage();
  console.log('[1] 已连接');
  await client.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  console.log('[2] 已切换路由');
  await new Promise(r => setTimeout(r, 2600));
  await client.send('Page.enable');
  console.log('[3] Page.enable 完成');
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    // 只拍顶栏区域，减小数据量
    clip: { x: 0, y: 0, width: 1280, height: 120, scale: 1 }
  });
  console.log('[4] 截图完成, 字节:', shot.data ? shot.data.length : 0);
  fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));
  console.log(`已保存截图: ${output} (当前路由 ${hash})`);
  client.close();
}

main().catch(e => {
  console.error('截图失败:', e.message);
  process.exit(1);
});
