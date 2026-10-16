/**
 * MOBI / AZW3 解析器
 *
 * MOBI 是 Kindle 的电子书容器，AZW3 即 KF8（MOBI 的新版）。解析交给
 * @lingo-reader/mobi-parser —— Vite 会取它的 browser 构建，不依赖 node:fs。
 *
 * 一个关键坑：该库在 browser 构建下把书内图片转成 URL.createObjectURL 的
 * blob 地址，而 blob 只在当前会话有效。入库前必须 fetch 回来转成 data URL，
 * 否则重启应用后图片全裂。
 */

import { initKf8File, initMobiFile } from '@lingo-reader/mobi-parser';
import { BookParser, Chapter } from '../book-parser';
import { newError } from '../../utils';
import { readFile } from '../../../worker';
import { xhtmlToBlocks } from '../epub-parser/content';
import { basename, bytesToBase64 } from '../utils';

type MobiChapter = { id: string, text: string }

type MobiLike = {
  getMetadata: () => { title?: string, author?: string[], description?: string }
  getSpine: () => MobiChapter[]
  loadChapter: (id: string) => { html: string } | undefined
  getCoverImage: () => string
  getToc?: () => { label: string }[]
  destroy: () => void
}

/** blob 地址只在当前会话有效，取回字节转成 data URL 才能入库 */
const blobToDataUrl = async (src: string) => {
  try {
    const res = await fetch(src);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength <= 0) {
      return void 0;
    }
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${bytesToBase64(bytes)}`;
  } catch {
    return void 0;
  }
};

/** 章节内资源引用解析：blob 转 data URL，data 原样保留，外部资源不加载 */
const resolveMobiResource = async (src: string) => {
  const value = src.trim();
  if (value === '') {
    return void 0;
  }
  if (/^blob:/i.test(value)) {
    return await blobToDataUrl(value);
  }
  if (/^data:/i.test(value)) {
    return value;
  }
  return void 0;
};

export class MobiParser extends BookParser {
  private readonly parser: MobiLike;
  private readonly sourceName: string;
  private coverResolved = false;
  private coverUrl?: string;

  private constructor(parser: MobiLike, sourceName: string) {
    super();
    this.parser = parser;
    this.sourceName = sourceName;
  }

  /**
   * MOBI 有 PalmDOC 与 KF8 两种容器。先按 MOBI 解析，
   * 失败或无章节时回退到 KF8（AZW3 属于 KF8）。
   */
  public static async loadFromBuffer(buffer: Uint8Array, sourceName = '') {
    let parser: MobiLike | undefined;
    try {
      parser = await initMobiFile(buffer, 'mobi-resources') as unknown as MobiLike;
      if (parser.getSpine().length <= 0) {
        parser.destroy();
        parser = undefined;
      }
    } catch {
      parser = undefined;
    }
    if (parser === undefined) {
      parser = await initKf8File(buffer, 'mobi-resources') as unknown as MobiLike;
    }
    if (parser.getSpine().length <= 0) {
      throw newError('MOBI 解析失败: 未解析出章节');
    }
    return new MobiParser(parser, sourceName);
  }

  /** 从本地文件加载 */
  public static async loadFromFilePath(filepath: string) {
    const buffer = await readFile(filepath);
    return await MobiParser.loadFromBuffer(buffer, basename(filepath.replace(/\\/g, '/')));
  }

  public getBookName() {
    const meta = this.parser.getMetadata();
    return Promise.resolve(meta.title || this.fallbackName());
  }

  public getAuthor() {
    const meta = this.parser.getMetadata();
    const author = meta.author;
    return Promise.resolve(Array.isArray(author) && author.length > 0 ? author.join('、') : '');
  }

  public getIntro() {
    const meta = this.parser.getMetadata();
    return Promise.resolve(meta.description || '');
  }

  public async getCoverImageUrl() {
    if (!this.coverResolved) {
      const url = this.parser.getCoverImage();
      this.coverUrl = url ? await blobToDataUrl(url) : void 0;
      this.coverResolved = true;
    }
    return this.coverUrl;
  }

  public getChapterTitleList() {
    const toc = this.parser.getToc?.();
    if (toc && toc.length > 0) {
      return Promise.resolve(toc.map(item => item.label));
    }
    return Promise.resolve(this.parser.getSpine().map((_, i) => `第${i + 1}章`));
  }

  public async getChapterList() {
    const spine = this.parser.getSpine();
    const titles = await this.getChapterTitleList();
    const chapters: Chapter[] = [];
    for (let i = 0; i < spine.length; i++) {
      const chapter = this.parser.loadChapter(spine[i].id);
      const html = chapter?.html || '';
      const blocks = html === '' ? [] : await xhtmlToBlocks(html, resolveMobiResource);
      chapters.push({
        title: titles[i] || `第${i + 1}章`,
        contents: blocks.length > 0 ? blocks : ['（本章内容无法读取）']
      });
    }
    return chapters;
  }

  private fallbackName() {
    return this.sourceName.replace(/\.[^.]+$/, '').trim() || '未命名书籍';
  }
}
