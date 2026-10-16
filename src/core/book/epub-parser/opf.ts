/**
 * EPUB 包文档（OPF）与目录（NCX / nav）解析
 */

import { newError } from '../../utils';
import { removeHTMLTags } from '../../utils/html';
import {
  dirname,
  findElement,
  findElements,
  isImagePath,
  normalizeSpace,
  parseDocument,
  resolvePath,
  safeDecode,
  stripUrlSuffix
} from './utils';

export type ManifestItem = {
  id: string
  /** zip 内的绝对路径（已解码、已归一化） */
  path: string
  mediaType: string
  /** EPUB3 的 properties 属性，空格分隔 */
  properties: string[]
}

export type SpineItem = {
  idref: string
  linear: boolean
}

export type OpfData = {
  /** OPF 所在目录，用于解析相对路径 */
  dir: string
  title: string
  author: string
  intro: string
  language: string
  /** <meta name="cover" content="..."> 指向的 manifest id */
  coverId: string
  /** <spine toc="..."> 指向的 NCX manifest id */
  tocId: string
  manifest: ManifestItem[]
  spine: SpineItem[]
  /** <guide> 中 type="cover" 的 href（zip 内绝对路径） */
  guideCover: string
}

const textOf = (el: Element | null) => normalizeSpace(el?.textContent || '');

/** 是否为可阅读的正文文档 */
export const isContentItem = (item: ManifestItem) => {
  if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') {
    return true;
  }
  if (item.mediaType === '') {
    return /\.x?html?$/i.test(item.path);
  }
  return false;
}

/** 是否为图片资源 */
export const isImageItem = (item: ManifestItem) => {
  return item.mediaType.startsWith('image/') || isImagePath(item.path);
}

export const parseOpf = (source: string, opfPath: string): OpfData => {
  const doc = parseDocument(source, 'text/xml');
  const dir = dirname(opfPath);
  const metadata = findElement(doc, 'metadata');
  const manifestEl = findElement(doc, 'manifest');
  const spineEl = findElement(doc, 'spine');
  if (!manifestEl || !spineEl) {
    throw newError('EPUB 解析失败: OPF 中缺少 manifest 或 spine');
  }
  const coverMeta = findElements(metadata, 'meta')
    .find(el => (el.getAttribute('name') || '').toLowerCase() === 'cover');
  const manifest: ManifestItem[] = findElements(manifestEl, 'item')
    .map(el => {
      const href = (el.getAttribute('href') || '').trim();
      return {
        id: (el.getAttribute('id') || '').trim(),
        path: href === '' ? '' : resolvePath(dir, safeDecode(stripUrlSuffix(href))),
        mediaType: (el.getAttribute('media-type') || '').trim().toLowerCase(),
        properties: (el.getAttribute('properties') || '').split(/\s+/).filter(v => v !== '')
      };
    })
    .filter(item => item.id !== '' && item.path !== '');
  const spine: SpineItem[] = findElements(spineEl, 'itemref')
    .map(el => ({
      idref: (el.getAttribute('idref') || '').trim(),
      linear: (el.getAttribute('linear') || 'yes').trim().toLowerCase() !== 'no'
    }))
    .filter(item => item.idref !== '');
  const coverRef = findElements(findElement(doc, 'guide'), 'reference')
    .find(el => (el.getAttribute('type') || '').toLowerCase().includes('cover'));
  const coverHref = (coverRef?.getAttribute('href') || '').trim();
  return {
    dir,
    title: textOf(findElement(metadata, 'title')),
    author: textOf(findElement(metadata, 'creator')),
    intro: normalizeSpace(removeHTMLTags(textOf(findElement(metadata, 'description')))),
    language: textOf(findElement(metadata, 'language')),
    coverId: (coverMeta?.getAttribute('content') || '').trim(),
    tocId: (spineEl.getAttribute('toc') || '').trim(),
    manifest,
    spine,
    guideCover: coverHref === '' ? '' : resolvePath(dir, safeDecode(stripUrlSuffix(coverHref)))
  };
}

/** 解析 EPUB2 的 NCX 目录，返回「zip 内路径 -> 章节标题」 */
export const parseNcx = (source: string, ncxPath: string) => {
  const doc = parseDocument(source, 'text/xml');
  const dir = dirname(ncxPath);
  const titles = new Map<string, string>();
  for (const navPoint of findElements(doc, 'navpoint')) {
    const src = (findElement(navPoint, 'content')?.getAttribute('src') || '').trim();
    const title = textOf(findElement(navPoint, 'text'));
    if (src === '' || title === '') {
      continue;
    }
    titles.set(resolvePath(dir, safeDecode(stripUrlSuffix(src))), title);
  }
  return titles;
}

/** 解析 EPUB3 的 nav 文档，返回「zip 内路径 -> 章节标题」 */
export const parseNav = (source: string, navPath: string) => {
  const doc = parseDocument(source);
  const dir = dirname(navPath);
  const titles = new Map<string, string>();
  const navs = findElements(doc, 'nav');
  const toc = navs.find(el => {
    const type = el.getAttribute('epub:type')
      || el.getAttribute('type')
      || el.getAttribute('role')
      || '';
    return type.toLowerCase().includes('toc');
  }) || navs[0];
  if (!toc) {
    return titles;
  }
  for (const a of findElements(toc, 'a')) {
    const href = (a.getAttribute('href') || '').trim();
    const title = normalizeSpace(a.textContent || '');
    if (href === '' || title === '') {
      continue;
    }
    titles.set(resolvePath(dir, safeDecode(stripUrlSuffix(href))), title);
  }
  return titles;
}
