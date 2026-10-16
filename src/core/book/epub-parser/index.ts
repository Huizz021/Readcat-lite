/**
 * EPUB 本地书籍解析器
 *
 * EPUB 本质是一个 zip 容器，结构为：
 *   META-INF/container.xml  -> 指向 OPF 包文档
 *   *.opf                   -> metadata / manifest / spine
 *   *.ncx / nav.xhtml       -> 目录
 *   *.xhtml                 -> 章节正文
 *
 * 解析结果通过 BookParser.toDatabaseEntity() 落到与 txt 本地书籍相同的
 * IndexedDB 存储（bookshelfStore + textContentStore），因此阅读页无需任何改动。
 */

import JSZip from 'jszip';
import { lookup } from 'mime-types';
import { BookParser, Chapter } from '../book-parser';
import { newError } from '../../utils';
import { readFile } from '../../../worker';
import { xhtmlToBlocks } from './content';
import {
  isContentItem,
  isImageItem,
  ManifestItem,
  OpfData,
  parseNcx,
  parseNav,
  parseOpf
} from './opf';
import {
  basename,
  bytesToBase64,
  decodeBytes,
  dirname,
  findElement,
  findElements,
  normalizePath,
  normalizeSpace,
  parseDocument,
  resolvePath,
  safeDecode,
  stripUrlSuffix
} from './utils';

/** 单张图片转 data URL 的体积上限，超出则丢弃，避免数据库体积失控 */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

/** zip 内路径 -> 文件对象 */
type ZipFiles = Map<string, JSZip.JSZipObject>;

type EpubContext = {
  files: ZipFiles
  /** 小写路径索引，容忍书籍内部大小写不一致的引用 */
  lowerFiles: ZipFiles
  opf: OpfData
  chapters: ManifestItem[]
  /** zip 内路径 -> 章节标题 */
  navTitles: Map<string, string>
  sourceName: string
}

const getZipFile = (files: ZipFiles, lowerFiles: ZipFiles, path: string) => {
  return files.get(path) || lowerFiles.get(path.toLowerCase());
}

const readZipEntry = async (file: JSZip.JSZipObject | undefined) => {
  if (!file) {
    return void 0;
  }
  return decodeBytes(await file.async('uint8array'));
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export class EpubParser extends BookParser {
  private readonly ctx: EpubContext;
  private readonly titleCache = new Map<string, string>();
  private coverUrl?: string;
  private coverResolved = false;

  private constructor(ctx: EpubContext) {
    super();
    this.ctx = ctx;
  }

  /** 从内存字节加载 */
  public static async loadFromBuffer(buffer: Uint8Array, sourceName = '') {
    const zip = await JSZip.loadAsync(buffer);
    return await EpubParser.create(zip, sourceName);
  }

  /** 从本地文件加载 */
  public static async loadFromFilePath(filepath: string) {
    const buffer = await readFile(filepath);
    return await EpubParser.loadFromBuffer(buffer, basename(filepath.replace(/\\/g, '/')));
  }

  private static async create(zip: JSZip, sourceName: string): Promise<EpubParser> {
    const files: ZipFiles = new Map();
    const lowerFiles: ZipFiles = new Map();
    zip.forEach((relativePath, file) => {
      if (file.dir) {
        return;
      }
      const path = normalizePath(relativePath);
      if (path === '') {
        return;
      }
      files.set(path, file);
      const lower = path.toLowerCase();
      lowerFiles.has(lower) || lowerFiles.set(lower, file);
    });

    const containerSource = await readZipEntry(getZipFile(files, lowerFiles, 'META-INF/container.xml'));
    if (containerSource === undefined) {
      throw newError('EPUB 解析失败: 缺少 META-INF/container.xml');
    }
    const rootfiles = findElements(parseDocument(containerSource, 'text/xml'), 'rootfile');
    const rootfile = rootfiles.find(el => (el.getAttribute('media-type') || '').includes('oebps-package'))
      || rootfiles[0];
    const opfHref = (rootfile?.getAttribute('full-path') || '').trim();
    if (opfHref === '') {
      throw newError('EPUB 解析失败: container.xml 中未找到 rootfile');
    }
    const opfPath = normalizePath(safeDecode(opfHref));
    const opfSource = await readZipEntry(getZipFile(files, lowerFiles, opfPath));
    if (opfSource === undefined) {
      throw newError(`EPUB 解析失败: 未找到包文档 ${opfPath}`);
    }
    const opf = parseOpf(opfSource, opfPath);

    // 章节：按 spine 顺序取正文文档；正常情况下跳过 linear="no" 的附属页面
    const pickChapters = (onlyLinear: boolean) => {
      const list: ManifestItem[] = [];
      for (const item of opf.spine) {
        if (onlyLinear && !item.linear) {
          continue;
        }
        const target = opf.manifest.find(i => i.id === item.idref);
        if (target && isContentItem(target)) {
          list.push(target);
        }
      }
      return list;
    };
    let chapters = pickChapters(true);
    if (chapters.length <= 0) {
      // 部分书籍把所有 itemref 都标成了 linear="no"，此时退回全量
      chapters = pickChapters(false);
    }

    // 目录：先取 EPUB2 的 NCX，再用 EPUB3 的 nav 覆盖（nav 更贴近实际阅读顺序）
    const navTitles = new Map<string, string>();
    const ncxItem = opf.manifest.find(i => i.id === opf.tocId)
      || opf.manifest.find(i => i.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncxSource = await readZipEntry(getZipFile(files, lowerFiles, ncxItem.path));
      if (ncxSource !== undefined) {
        parseNcx(ncxSource, ncxItem.path).forEach((title, path) => navTitles.set(path, title));
      }
    }
    const navItem = opf.manifest.find(i => i.properties.includes('nav'));
    if (navItem) {
      const navSource = await readZipEntry(getZipFile(files, lowerFiles, navItem.path));
      if (navSource !== undefined) {
        parseNav(navSource, navItem.path).forEach((title, path) => navTitles.set(path, title));
      }
    }

    return new EpubParser({ files, lowerFiles, opf, chapters, navTitles, sourceName });
  }

  public getBookName() {
    return Promise.resolve(this.ctx.opf.title || this.fallbackName());
  }

  public getAuthor() {
    return Promise.resolve(this.ctx.opf.author);
  }

  public getIntro() {
    return Promise.resolve(this.ctx.opf.intro);
  }

  public async getCoverImageUrl() {
    if (!this.coverResolved) {
      this.coverUrl = await this.resolveCover();
      this.coverResolved = true;
    }
    return this.coverUrl;
  }

  public async getChapterTitleList() {
    const titles: string[] = [];
    for (let i = 0; i < this.ctx.chapters.length; i++) {
      titles.push(await this.resolveTitle(this.ctx.chapters[i], i));
    }
    return titles;
  }

  public async getChapterList() {
    const chapters: Chapter[] = [];
    for (let i = 0; i < this.ctx.chapters.length; i++) {
      const item = this.ctx.chapters[i];
      chapters.push({
        title: await this.resolveTitle(item, i),
        contents: await this.readChapter(item)
      });
    }
    return chapters;
  }

  private fallbackName() {
    return this.ctx.sourceName.replace(/\.[^.]+$/, '').trim() || '未命名书籍';
  }

  /** 章节标题：优先用目录中的标题，其次取正文里的首个标题，最后回退为序号 */
  private async resolveTitle(item: ManifestItem, index: number) {
    const cached = this.titleCache.get(item.path);
    if (cached !== undefined) {
      return cached;
    }
    let title = this.ctx.navTitles.get(item.path) || '';
    if (title === '') {
      title = await this.titleFromDocument(item.path);
    }
    if (title === '') {
      title = `第${index + 1}章`;
    }
    this.titleCache.set(item.path, title);
    return title;
  }

  private async titleFromDocument(path: string) {
    const source = await this.readText(path);
    if (source === undefined) {
      return '';
    }
    const doc = parseDocument(source);
    const heading = HEADING_TAGS
      .map(tag => normalizeSpace(findElement(doc, tag)?.textContent || ''))
      .find(val => val !== '');
    if (heading) {
      return heading;
    }
    return normalizeSpace(findElement(doc, 'title')?.textContent || '');
  }

  private async readChapter(item: ManifestItem) {
    const source = await this.readText(item.path);
    if (source === undefined) {
      return ['（本章内容无法读取）'];
    }
    const dir = dirname(item.path);
    const blocks = await xhtmlToBlocks(source, async src => await this.resolveResource(dir, src));
    return blocks.length > 0 ? blocks : ['（本章无可显示内容）'];
  }

  private async readText(path: string) {
    return await readZipEntry(getZipFile(this.ctx.files, this.ctx.lowerFiles, path));
  }

  /** 把章节内的资源引用解析为可渲染的地址；外部网络资源一律不加载 */
  private async resolveResource(baseDir: string, src: string) {
    const value = src.trim();
    if (value === '') {
      return void 0;
    }
    if (/^data:/i.test(value)) {
      return value;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return void 0;
    }
    return await this.readImageDataUrl(resolvePath(baseDir, safeDecode(stripUrlSuffix(value))));
  }

  private async readImageDataUrl(path: string) {
    const file = getZipFile(this.ctx.files, this.ctx.lowerFiles, path);
    if (!file) {
      return void 0;
    }
    const bytes = await file.async('uint8array');
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_SIZE) {
      return void 0;
    }
    const mime = lookup(path) || 'image/jpeg';
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  /** 封面：依次尝试 meta[name=cover]、cover-image 属性、guide、文件名含 cover、首张图片 */
  private async resolveCover() {
    const images = this.ctx.opf.manifest.filter(isImageItem);
    const candidates: ManifestItem[] = [];
    const push = (item?: ManifestItem) => {
      if (item && !candidates.includes(item)) {
        candidates.push(item);
      }
    };
    push(this.ctx.opf.manifest.find(i => i.id === this.ctx.opf.coverId));
    push(images.find(i => i.properties.includes('cover-image')));
    const guideItem = this.ctx.opf.manifest.find(i => i.path === this.ctx.opf.guideCover);
    if (guideItem) {
      if (isImageItem(guideItem)) {
        push(guideItem);
      } else {
        // guide 指向的是包含封面的页面，再往里找一次图片
        const inner = await this.findFirstImageRef(guideItem.path);
        if (inner !== undefined) {
          push(this.ctx.opf.manifest.find(i => i.path === inner));
        }
      }
    }
    push(images.find(i => /cover/i.test(basename(i.path))));
    push(images[0]);
    for (const item of candidates) {
      const url = await this.readImageDataUrl(item.path);
      if (url !== undefined) {
        return url;
      }
    }
    return void 0;
  }

  /** 读取某个文档中第一张图片的 zip 内路径 */
  private async findFirstImageRef(path: string) {
    const source = await this.readText(path);
    if (source === undefined) {
      return void 0;
    }
    const doc = parseDocument(source);
    const img = findElements(doc, 'img')[0] || findElements(doc, 'image')[0];
    if (!img) {
      return void 0;
    }
    const xlink = 'http://www.w3.org/1999/xlink';
    const ref = (img.getAttribute('src')
      || img.getAttribute('xlink:href')
      || img.getAttributeNS(xlink, 'href')
      || '').trim();
    if (ref === '' || /^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      return void 0;
    }
    return resolvePath(dirname(path), safeDecode(stripUrlSuffix(ref)));
  }
}
