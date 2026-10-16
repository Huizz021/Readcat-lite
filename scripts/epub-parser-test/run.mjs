/**
 * 验证脚本：打包 entry.ts，用系统上的 Chromium 内核浏览器以 headless 方式执行，
 * 再把解析结果读回来并输出报告。
 *
 * 之所以走浏览器而不是 jsdom：解析器依赖 DOMParser 对 XHTML/XML 的处理细节，
 * 只有真实的 Chromium 内核才能反映实际运行环境（Electron 渲染进程）的行为。
 *
 * 用法：node scripts/epub-parser-test/run.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { reportFromHtml } from './report.mjs';
import { DEFAULT_FIXTURE, generateFixture } from './gen-fixture.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

const WINDOWS_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
const MAC_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];
const PATH_BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge'];

/** 异步执行命令；同步变体（spawnSync 等）在部分受限环境中会被拦截 */
const run = (command, args, options = {}) => {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: options.shell === true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let error = null;
    const timer = setTimeout(() => {
      error = new Error('执行超时');
      child.kill();
    }, options.timeout || 180000);
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', e => { error = e; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error });
    });
  });
}

/** 绝对路径的浏览器直接调用（路径含空格，不能经过 shell）；PATH 里的命令需要 shell 解析 */
const findBrowser = async () => {
  for (const file of [...WINDOWS_BROWSERS, ...MAC_BROWSERS]) {
    if (fs.existsSync(file)) {
      return { command: file, shell: false };
    }
  }
  for (const cmd of PATH_BROWSERS) {
    const res = await run(cmd, ['--version'], { shell: true, timeout: 15000 });
    if (res.code === 0) {
      return { command: cmd, shell: true };
    }
  }
  return undefined;
}

const main = async () => {
  await import('./build.mjs');
  generateFixture(path.join(dir, 'fixtures', DEFAULT_FIXTURE));

  const browser = await findBrowser();
  if (!browser) {
    console.error('未找到 Chromium 内核浏览器，无法执行验证。');
    process.exit(2);
  }
  console.log(`使用浏览器: ${browser.command}\n`);

  const page = pathToFileURL(path.join(dir, 'index.html')).href;
  // 必须指定独立的 user-data-dir，否则 Chrome 会把参数交给已运行的实例，导致拿不到输出
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-epub-test-'));
  const res = await run(browser.command, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=60000',
    '--dump-dom',
    page
  ], { shell: browser.shell, timeout: 180000 });
  fs.rmSync(profile, { recursive: true, force: true });

  if (!res.stdout) {
    console.error(`未能获取浏览器输出${res.error ? `: ${res.error.message}` : `（退出码 ${res.code}）`}`);
    console.error('\n可手动执行以下命令后，再运行 report.mjs：');
    console.error(`  "${browser.command}" --headless=new --disable-gpu --no-sandbox \\`);
    console.error(`    --virtual-time-budget=60000 --dump-dom "${page}" > dump.html`);
    console.error('  node scripts/epub-parser-test/report.mjs dump.html');
    process.exit(2);
  }

  process.exit(reportFromHtml(res.stdout));
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
