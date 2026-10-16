/**
 * CBZ 漫画解析器
 *
 * CBZ 本质是「图片打包成 zip」，没有强制的元数据规范。不过存在事实标准
 * ComicInfo.xml（ComicRack 提出），规范的漫画文件会带上系列名、作者与简介。
 *
 * 解析结果通过 BookParser.toDatabaseEntity() 落到与 txt / epub 相同的
 * IndexedDB 存储，因此阅读页无需任何改动。
 */

import JSZip from 'jszip';
import { lookup } from 'mime-types';
import { BookParser, Chapter } from '../book-parser';
import { newError } from '../../utils';
import { readFile } from '../../../worker';
import {
  basename,
  bytesToBase64,
  findElement,
  isImagePath,
  normalizeSpace,
  parseDocument
} from '../utils';

/** 单页图片转 data URL 的体积上限，超出则丢弃，避免数据库体积失控 */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

/** 压缩包内需要忽略的条目：macOS 资源叉、系统缩略图等 */
const IGNORED_PATH = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\._)/i;

/** 缺少元数据时的作者占位，避免用户在导入窗口被强制填写 */
const UNKNOWN_AUTHOR = '未知';

type ComicPage = {
  path: string
  file: JSZip.JSZipObject
}

type ComicInfo = {
  title?: string
  author?: string
  intro?: string
}

/** 自然序比较：让 page2 排在 page10 前面，这是漫画分页的关键 */
const naturalCompare = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const pageTitle = (index: number) => `第${index + 1}页`;

/** 读取 ComicInfo.xml；该文件并非所有漫画都有，缺失时返回空对象 */
const readComicInfo = async (zip: JSZip): Promise<ComicInfo> => {
  const file = Object.values(zip.files).find(f => !f.dir && /(^|\/)ComicInfo\.xml$/i.test(f.name));
  if (!file) {
    return {};
  }
  try {
    const doc = parseDocument(await file.async('string'), 'text/xml');
    const text = (tag: string) => normalizeSpace(findElement(doc, tag)?.textContent || '');
    return {
      title: text('Series') || text('Title'),
      author: text('Writer') || text('Penciller'),
      intro: text('Summary')
    };
  } catch {
    // 元数据解析失败不应影响正文
    return {};
  }
}

export class ComicParser extends BookParser {
  private readonly pages: ComicPage[];
  private readonly info: ComicInfo;
  private readonly sourceName: string;
  private coverResolved = false;
  private coverUrl?: string;

  private constructor(pages: ComicPage[], info: ComicInfo, sourceName: string) {
    super();
    this.pages = pages;
    this.info = info;
    this.sourceName = sourceName;
  }

  /** 从内存字节加载 */
  public static async loadFromBuffer(buffer: Uint8Array, sourceName = '') {
    const zip = await JSZip.loadAsync(buffer);
    return await ComicParser.create(zip, sourceName);
  }

  /** 从本地文件加载 */
  public static async loadFromFilePath(filepath: string) {
    const buffer = await readFile(filepath);
    return await ComicParser.loadFromBuffer(buffer, basename(filepath.replace(/\\/g, '/')));
  }

  private static async create(zip: JSZip, sourceName: string) {
    const pages: ComicPage[] = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) {
        return;
      }
      const path = relativePath.replace(/\\/g, '/');
      if (IGNORED_PATH.test(path) || !isImagePath(path)) {
        return;
      }
      pages.push({ path, file });
    });
    if (pages.length <= 0) {
      throw newError('CBZ 解析失败: 压缩包内没有图片');
    }
    pages.sort((a, b) => naturalCompare(a.path, b.path));
    const info = await readComicInfo(zip);
    return new ComicParser(pages, info, sourceName);
  }

  /** 漫画走双页并排排版 */
  protected getBookType(): 'comic' | 'text' {
    return 'comic';
  }

  public getBookName() {
    return Promise.resolve(this.info.title || this.fallbackName());
  }

  public getAuthor() {
    return Promise.resolve(this.info.author || UNKNOWN_AUTHOR);
  }

  public getIntro() {
    return Promise.resolve(this.info.intro || '');
  }

  public async getCoverImageUrl() {
    if (!this.coverResolved) {
      this.coverUrl = await this.readImageDataUrl(this.pages[0]);
      this.coverResolved = true;
    }
    return this.coverUrl;
  }

  public getChapterTitleList() {
    return Promise.resolve(this.pages.map((_, i) => pageTitle(i)));
  }

  public async getChapterList() {
    const chapters: Chapter[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      chapters.push({
        title: pageTitle(i),
        contents: await this.readPage(this.pages[i])
      });
    }
    return chapters;
  }

  private fallbackName() {
    return this.sourceName.replace(/\.[^.]+$/, '').trim() || '未命名漫画';
  }

  /** 一页 = 一个章节，内容就是一张内嵌图片 */
  private async readPage(page: ComicPage): Promise<string[]> {
    const url = await this.readImageDataUrl(page);
    return url === undefined ? ['（本页图片无法读取）'] : [`<img src="${url}"/>`];
  }

  private async readImageDataUrl(page: ComicPage) {
    const bytes = await page.file.async('uint8array');
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_SIZE) {
      return void 0;
    }
    const mime = lookup(page.path) || 'image/jpeg';
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }
}
