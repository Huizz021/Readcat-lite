/**
 * XHTML 章节正文转换为阅读器可用的段落数组
 *
 * 阅读器（src/views/read/index.vue）会把 textContent 数组的每一项塞进
 * <div data-index="N"> 后通过 v-html 渲染，因此这里需要把一章 XHTML 拆成若干「块」。
 *
 * 关于书签：src/views/components/bookmark 依据 DOM 文本偏移量对原始字符串做 slice，
 * 所以纯文本段落必须输出**未带标签的纯文本**（仅做实体转义），否则书签高亮会错位。
 * 只有含图片的段落才保留少量 HTML，这类段落占比很低。
 */

import { escapeHTML } from '../../utils/html';
import { findElement, findElements, normalizeSpace, parseDocument } from '../utils';

/** 解析时直接丢弃的元素 */
const SKIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'base',
  'noscript', 'iframe', 'frame', 'object', 'embed', 'applet',
  'video', 'audio', 'canvas', 'map', 'area',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'label'
]);

/** 块级元素：每个块级元素（或块级元素内的行内内容）独立成为一个段落 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'center',
  'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'ul'
]);

/** 含图片段落中允许保留的行内语义标签 */
const INLINE_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins',
  'sub', 'sup', 'small', 'big', 'mark', 'code', 'kbd', 'samp',
  'cite', 'q', 'abbr', 'dfn', 'var', 'time', 'ruby', 'rt', 'rp', 'span'
]);

const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(',');
const IMAGE_SELECTOR = 'img, image, svg';

/** 把 epub 内部资源引用解析为可直接渲染的地址 */
export type ImageResolver = (src: string) => Promise<string | undefined>;

const escapeAttr = (val: string) => {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 取出元素上指向图片的引用，兼容 src / href / xlink:href 三种写法 */
const imageRefOf = (el: Element) => {
  const xlink = 'http://www.w3.org/1999/xlink';
  const value = el.getAttribute('src')
    || el.getAttribute('xlink:href')
    || el.getAttribute('href')
    || el.getAttributeNS(xlink, 'href')
    || '';
  return value.trim();
}

const resolveImageEl = async (el: Element, resolveImage: ImageResolver) => {
  const ref = imageRefOf(el);
  return ref === '' ? void 0 : await resolveImage(ref);
}

/** 序列化行内内容；遇到块级元素不再展开（由调用方保证只传入行内节点） */
const serializeInline = async (node: Node, out: string[], resolveImage: ImageResolver) => {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(escapeHTML(node.nodeValue || ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const el = <Element>node;
  const tag = (el.localName || el.tagName).toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    return;
  }
  if (tag === 'br') {
    out.push('<br/>');
    return;
  }
  if (tag === 'hr') {
    out.push('<hr/>');
    return;
  }
  if (tag === 'img' || tag === 'image') {
    const url = await resolveImageEl(el, resolveImage);
    if (url) {
      const alt = el.getAttribute('alt') || '';
      out.push(`<img src="${escapeAttr(url)}"${alt === '' ? '' : ` alt="${escapeAttr(alt)}"`}/>`);
    }
    return;
  }
  if (tag === 'svg') {
    // EPUB 中 svg 通常只是图片的包装，取出其中的图片引用后替换为普通 img
    const image = findElements(el, 'image')[0];
    const url = image ? await resolveImageEl(image, resolveImage) : void 0;
    if (url) {
      out.push(`<img src="${escapeAttr(url)}"/>`);
    }
    return;
  }
  const keep = INLINE_TAGS.has(tag);
  if (keep) {
    out.push(`<${tag}>`);
  }
  for (const child of Array.from(el.childNodes)) {
    await serializeInline(child, out, resolveImage);
  }
  if (keep) {
    out.push(`</${tag}>`);
  }
}

/**
 * 生成一个段落
 * 不含图片与换行符时输出纯文本（保证书签偏移量正确），
 * 否则输出保留图片、换行与行内语义标签的 HTML
 */
const makeBlock = async (nodes: Node[], resolveImage: ImageResolver): Promise<string | null> => {
  const hasRichContent = nodes.some(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const el = <Element>node;
    // 节点自身可能就是 img/svg（如封面页的 <body><img/></body>），因此要一并匹配
    return el.matches(IMAGE_SELECTOR)
      || el.querySelector(IMAGE_SELECTOR) !== null
      || el.querySelector('br') !== null;
  });
  if (!hasRichContent) {
    const text = normalizeSpace(nodes.map(node => node.textContent || '').join(''));
    return text === '' ? null : escapeHTML(text);
  }
  const out: string[] = [];
  for (const node of nodes) {
    await serializeInline(node, out, resolveImage);
  }
  const html = out.join('').trim();
  return html === '' ? null : html;
}

/** 递归拆块：遇到块级元素就断开当前行内缓冲，形成新的段落 */
const walk = async (node: Node, out: string[], resolveImage: ImageResolver) => {
  let buffer: Node[] = [];
  const flush = async () => {
    if (buffer.length <= 0) {
      return;
    }
    const pending = buffer;
    buffer = [];
    const block = await makeBlock(pending, resolveImage);
    if (block !== null) {
      out.push(block);
    }
  };
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.nodeValue || '').trim() !== '') {
        buffer.push(child);
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const el = <Element>child;
    const tag = (el.localName || el.tagName).toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      continue;
    }
    if (tag === 'br') {
      await flush();
      continue;
    }
    if (tag === 'hr') {
      await flush();
      out.push('<hr/>');
      continue;
    }
    if (tag === 'img' || tag === 'svg' || tag === 'image') {
      // 图片类元素单独成段，避免正文中连续的插图被挤进同一个段落
      await flush();
      const block = await makeBlock([el], resolveImage);
      if (block !== null) {
        out.push(block);
      }
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) {
      buffer.push(el);
      continue;
    }
    await flush();
    if (el.querySelector(BLOCK_SELECTOR) !== null) {
      // 块级元素内部还有块级元素（如 div>p、table>tr>td），继续向下拆分
      await walk(el, out, resolveImage);
      continue;
    }
    const block = await makeBlock([el], resolveImage);
    if (block !== null) {
      out.push(block);
    }
  }
  await flush();
}

/**
 * 把一章 XHTML 转换为段落数组
 * @param source 章节原始内容
 * @param resolveImage 图片引用解析函数，返回 undefined 表示该图片不可用（将被丢弃）
 */
export const xhtmlToBlocks = async (source: string, resolveImage: ImageResolver): Promise<string[]> => {
  const doc = parseDocument(source);
  const body = findElement(doc, 'body') || doc.body || doc.documentElement;
  if (!body) {
    return [];
  }
  const blocks: string[] = [];
  await walk(body, blocks, resolveImage);
  return blocks;
}
