/**
 * 漫画解析器（CBZ / CBR）
 *
 * CBZ 是「图片打包成 zip」，CBR 是同形式的 rar 归档。两者都只是图片容器，
 * 没有强制的元数据规范，但存在事实标准 ComicInfo.xml（ComicRack 提出），
 * 规范的漫画文件会带上系列名、作者与简介。
 *
 * 解析结果通过 BookParser.toDatabaseEntity() 落到与 txt / epub 相同的
 * IndexedDB 存储，因此阅读页无需任何改动。
 */

import JSZip from 'jszip';
import { lookup } from 'mime-types';
import { createExtractorFromData } from 'node-unrar-js';
// node-unrar-js 内部用 fetch('unrar.wasm') 取 WASM，打包后该文件不在旁边会直接失败。
// 用 Vite 的 ?url 把它作为资源引入，再由我们显式传 wasmBinary 进去。
import wasmUrl from 'node-unrar-js/dist/js/unrar.wasm?url';
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

/** 归档内需要忽略的条目：macOS 资源叉、系统缩略图等 */
const IGNORED_PATH = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\._)/i;

/** 缺少元数据时的作者占位，避免用户在导入窗口被强制填写 */
const UNKNOWN_AUTHOR = '未知';

type ComicEntry = {
  /** 归档内的相对路径，用于排序与判断类型 */
  name: string
  read: () => Promise<Uint8Array>
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
const readComicInfo = (xml: string): ComicInfo => {
  try {
    const doc = parseDocument(xml, 'text/xml');
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

/** 解出 zip 内的条目（CBZ） */
const readZipEntries = async (buffer: Uint8Array): Promise<ComicEntry[]> => {
  const zip = await JSZip.loadAsync(buffer);
  const entries: ComicEntry[] = [];
  zip.forEach((name, file) => {
    if (file.dir) {
      return;
    }
    entries.push({ name: name.replace(/\\/g, '/'), read: () => file.async('uint8array') });
  });
  return entries;
};

/** WASM 只加载一次并缓存，避免每次导入 CBR 都重新取 */
let wasmBinary: ArrayBuffer | undefined;
const getWasmBinary = async (): Promise<ArrayBuffer> => {
  if (wasmBinary === undefined) {
    const res = await fetch(wasmUrl);
    wasmBinary = await res.arrayBuffer();
  }
  return wasmBinary;
};

/** 解出 rar 内的条目（CBR）。node-unrar-js 为 WASM，一次性解压全部 */
const readRarEntries = async (buffer: Uint8Array): Promise<ComicEntry[]> => {
  // 该库的入参是 ArrayBuffer 而非 Uint8Array；仅在恰为完整视图时才零拷贝复用
  const raw: ArrayBufferLike = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
    ? buffer.buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const extractor = await createExtractorFromData({
    wasmBinary: await getWasmBinary(),
    data: raw as ArrayBuffer
  });
  const { files } = await extractor.extract();
  const list = Array.isArray(files) ? files : [...files];
  const entries: ComicEntry[] = [];
  for (const file of list) {
    if (file.fileHeader.flags.directory || !file.extraction) {
      continue;
    }
    const bytes = file.extraction;
    entries.push({
      name: file.fileHeader.name.replace(/\\/g, '/'),
      read: async () => bytes
    });
  }
  return entries;
};

export class ComicParser extends BookParser {
  private readonly entries: ComicEntry[];
  private readonly info: ComicInfo;
  private readonly sourceName: string;
  private coverResolved = false;
  private coverUrl?: string;

  private constructor(entries: ComicEntry[], info: ComicInfo, sourceName: string) {
    super();
    this.entries = entries;
    this.info = info;
    this.sourceName = sourceName;
  }

  /** 从内存字节加载，按魔数自动识别 CBZ / CBR */
  public static async loadFromBuffer(buffer: Uint8Array, sourceName = '') {
    const isRar = buffer.length >= 7
      && buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21
      && buffer[4] === 0x1a && buffer[5] === 0x07;
    const entries = isRar ? await readRarEntries(buffer) : await readZipEntries(buffer);
    return await ComicParser.create(entries, sourceName, isRar);
  }

  /** 从本地文件加载 */
  public static async loadFromFilePath(filepath: string) {
    const buffer = await readFile(filepath);
    return await ComicParser.loadFromBuffer(buffer, basename(filepath.replace(/\\/g, '/')));
  }

  private static async create(entries: ComicEntry[], sourceName: string, isRar: boolean) {
    const pages = entries.filter(e => !IGNORED_PATH.test(e.name) && isImagePath(e.name));
    if (pages.length <= 0) {
      throw newError(isRar ? 'CBR 解析失败: 压缩包内没有图片' : 'CBZ 解析失败: 压缩包内没有图片');
    }
    pages.sort((a, b) => naturalCompare(a.name, b.name));

    const infoFile = entries.find(e => /(^|\/)ComicInfo\.xml$/i.test(e.name));
    const info = infoFile ? readComicInfo(new TextDecoder().decode(await infoFile.read())) : {};

    return new ComicParser(pages, info, sourceName);
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

  /** 漫画走双页并排排版 */
  protected getBookType(): 'comic' | 'text' {
    return 'comic';
  }

  public async getCoverImageUrl() {
    if (!this.coverResolved) {
      this.coverUrl = await this.readImageDataUrl(this.entries[0]);
      this.coverResolved = true;
    }
    return this.coverUrl;
  }

  public getChapterTitleList() {
    return Promise.resolve(this.entries.map((_, i) => pageTitle(i)));
  }

  public async getChapterList() {
    const chapters: Chapter[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      chapters.push({
        title: pageTitle(i),
        contents: await this.readPage(this.entries[i])
      });
    }
    return chapters;
  }

  private fallbackName() {
    return this.sourceName.replace(/\.[^.]+$/, '').trim() || '未命名漫画';
  }

  /** 一页 = 一个章节，内容就是一张内嵌图片 */
  private async readPage(entry: ComicEntry): Promise<string[]> {
    const url = await this.readImageDataUrl(entry);
    return url === undefined ? ['（本页图片无法读取）'] : [`<img src="${url}"/>`];
  }

  private async readImageDataUrl(entry: ComicEntry) {
    const bytes = await entry.read();
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_SIZE) {
      return void 0;
    }
    const mime = lookup(entry.name) || 'image/jpeg';
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }
}
