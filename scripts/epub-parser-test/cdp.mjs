/**
 * 通过 Chrome DevTools Protocol 连接正在运行的 ReadCat 应用
 *
 * 用途：在真实打包产物里执行 JS / 派发输入事件，验证渲染进程与 epub 导入链路。
 * 前提：应用启动时带上 --remote-debugging-port=9222
 */
import WebSocket from 'ws';

const PORT = process.env.RC_CDP_PORT || 9222;

export const listTargets = async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return await res.json();
}

export const getPageTarget = async () => {
  const list = await listTargets();
  const page = list.find(t => t.type === 'page');
  if (!page) {
    throw new Error('未找到 page 类型的目标');
  }
  return page;
}

/** 连接页面并返回一个可复用的 CDP 客户端 */
export const connectPage = async () => {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  let seq = 0;
  const pending = new Map();
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const item = msg.id && pending.get(msg.id);
    if (!item) {
      return;
    }
    pending.delete(msg.id);
    msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = true) => {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  };
  await send('Runtime.enable');
  return { send, evaluate, close: () => ws.close() };
}

const entry = process.argv[1] || '';
if (entry.endsWith('cdp.mjs')) {
  const expression = process.argv[2];
  if (!expression) {
    console.error('用法: node scripts/epub-parser-test/cdp.mjs "<JS表达式>"');
    process.exit(2);
  }
  connectPage()
    .then(async client => {
      const value = await client.evaluate(expression);
      client.close();
      console.log(JSON.stringify(value, null, 2));
    })
    .catch(e => { console.error('求值失败:', e.message); process.exit(1); });
}
