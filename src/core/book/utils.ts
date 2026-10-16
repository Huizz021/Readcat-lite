/**
 * 本地书籍解析通用工具
 *
 * 说明：EPUB 内部大量使用 XML（OPF/NCX/XHTML），命名空间前缀（dc:、opf:、epub:）
 * 在不同书籍中写法并不统一，因此这里统一按 localName 匹配元素，忽略前缀差异。
 *
 * 这些工具由 EPUB / 漫画 等各类 BookParser 实现共用。
 */

/** 解析 XML，遇到非良构文档时回退为 HTML 解析 */
export const parseDocument = (source: string, type: DOMParserSupportedType = 'application/xhtml+xml'): Document => {
  const parser = new DOMParser();
  let doc: Document;
  try {
    doc = parser.parseFromString(source, type);
  } catch {
    // 部分实现（如 jsdom）在 XML 解析失败时直接抛错，而不是返回 parsererror 文档
    return parser.parseFromString(source, 'text/html');
  }
  if (isParseError(doc)) {
    return parser.parseFromString(source, 'text/html');
  }
  return doc;
}

/** 判断 DOMParser 是否返回了错误文档 */
export const isParseError = (doc: Document) => {
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return true;
  }
  const name = doc.documentElement?.localName || doc.documentElement?.nodeName || '';
  return name.toLowerCase() === 'parsererror';
}

/** 按 localName 查找全部后代元素（忽略命名空间前缀） */
export const findElements = (root: Element | Document | null | undefined, localName: string): Element[] => {
  if (!root) {
    return [];
  }
  const target = localName.toLowerCase();
  const nodes = root.getElementsByTagName('*');
  const result: Element[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if ((node.localName || node.tagName).toLowerCase() === target) {
      result.push(node);
    }
  }
  return result;
}

/** 按 localName 查找第一个后代元素 */
export const findElement = (root: Element | Document | null | undefined, localName: string) => {
  return findElements(root, localName)[0] || null;
}

/** 折叠空白字符（含全角空格、零宽字符），用于书名、标题等短文本 */
export const normalizeSpace = (val: string) => {
  return val.replace(/[\s\u00a0\u200b\ufeff]+/g, ' ').trim();
}

/** 去除 URL 上的 fragment 与 query，只保留资源路径 */
export const stripUrlSuffix = (url: string) => {
  const index = url.search(/[?#]/);
  return index < 0 ? url : url.slice(0, index);
}

/** 解码百分号编码，失败时原样返回（部分书籍的 href 本身包含裸 % 字符） */
export const safeDecode = (val: string) => {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

/** 归一化 zip 内部路径：统一分隔符并消解 . 与 .. */
export const normalizePath = (path: string) => {
  const absolute = path.startsWith('/');
  const stack: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return (absolute ? '/' : '') + stack.join('/');
}

/** 相对路径拼接：baseDir 为所在目录（zip 内路径） */
export const resolvePath = (baseDir: string, relative: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative)) {
    return relative;
  }
  if (relative.startsWith('/')) {
    return normalizePath(relative);
  }
  const dir = baseDir === '' ? '' : `${baseDir.replace(/\/+$/, '')}/`;
  return normalizePath(dir + relative);
}

/** 取目录部分 */
export const dirname = (path: string) => {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/** 取文件名部分 */
export const basename = (path: string) => {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/**
 * 按字节解码文本
 *
 * EPUB 规范要求 XML 使用 UTF-8 或 UTF-16，但实际书籍中偶有 GBK 等编码，
 * 这里优先遵循 BOM 与 XML 声明中的 encoding，失败再退回 UTF-8。
 */
export const decodeBytes = (bytes: Uint8Array) => {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
  }
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 256));
  const match = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (match) {
    try {
      return new TextDecoder(match[1].trim()).decode(bytes);
    } catch {
      // 不支持的编码名，退回 UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** 是否为图片资源路径 */
export const isImagePath = (path: string) => {
  return /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i.test(path);
}

/**
 * 字节转 base64
 *
 * 不使用 Buffer，以便解析器在渲染进程与普通浏览器环境下都能工作。
 */
export const bytesToBase64 = (bytes: Uint8Array) => {
  const CHUNK = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
