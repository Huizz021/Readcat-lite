/**
 * 用 esbuild 把 entry.ts 打包成可在浏览器（Chromium 内核）中直接执行的脚本
 *
 * 需要打桩三处：
 *  - ../../../worker  依赖 ?worker 导入，只有 vite 能处理
 *  - ../../utils      仅用到 newError，避免把 axios/crypto 一并拖进来
 *  - path             mime-types 只用到了 extname，浏览器没有该模块
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(dir, 'entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outfile: path.join(dir, 'bundle.js'),
  logLevel: 'info',
  // book-parser.ts 会导入占位封面图，这里按 data URL 处理
  loader: {
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.png': 'dataurl',
    '.gif': 'dataurl',
    '.webp': 'dataurl'
  },
  plugins: [
    {
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /^(\.\.\/\.\.\/\.\.\/worker|.*\?worker)$/ }, args => ({
          path: args.path,
          namespace: 'stub-worker'
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub-worker' }, () => ({
          contents: `
            export const readFile = async () => { throw new Error('readFile 在测试环境中不可用'); };
            export const decode = async () => { throw new Error('decode 在测试环境中不可用'); };
            export const getDirectorySize = async () => 0;
            export default class StubWorker {}
          `,
          loader: 'js'
        }));
        b.onResolve({ filter: /^\.\.\/\.\.\/utils$/ }, args => ({
          path: args.path,
          namespace: 'stub-utils'
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub-utils' }, () => ({
          contents: `export const newError = (message) => new Error(message);`,
          loader: 'js'
        }));
        b.onResolve({ filter: /^path$/ }, () => ({
          path: 'path',
          namespace: 'stub-path'
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub-path' }, () => ({
          contents: `
            export const extname = (p) => {
              const dot = p.lastIndexOf('.');
              const slash = p.lastIndexOf('/');
              return dot > slash ? p.slice(dot) : '';
            };
          `,
          loader: 'js'
        }));
      }
    }
  ]
});
