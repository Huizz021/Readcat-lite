/**
 * PDF 解析器
 *
 * PDF 没有「段落」概念，按用户选择的方式处理：把每一页渲染成图片，
 * 一页 = 一个章节。这样扫描版、图文混排、复杂排版都能原样呈现。
 *
 * 两个必须处理的坑：
 *
 * 1. Electron 31 的 Chromium 126 不支持 Promise.try（ES2025），
 *    而 pdfjs-dist 4/5/6 都用到了它。主线程和 worker 都要补 polyfill。
 * 2. worker 无法从 asar 内启动，也无法直接用 blob（它是 ESM，只有一句 export）。
 *    这里取 worker 源码、前置 polyfill、剥掉 export，再包成 blob URL。
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { BookParser, Chapter } from '../book-parser';
import { newError } from '../../utils';
import { readFile } from '../../../worker';
import { basename } from '../utils';

/** 渲染目标宽度（px），兼顾清晰度与体积 */
const TARGET_WIDTH = 1000;

/** 单页图片体积上限，超出则降低质量重试 */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

/** 画布总像素上限，防止超长页撑爆内存 */
const MAX_PIXELS = 3_000_000;

const PROMISE_TRY_POLYFILL = `
if (typeof Promise.try !== 'function') {
  Promise.try = function (fn) {
    return new Promise((resolve, reject) => {
      try {
        resolve(fn && fn.apply(null, [].slice.call(arguments, 1)));
      } catch (e) {
        reject(e);
      }
    });
  };
}
`;

// 主线程也要补，pdf.mjs 里同样用到了 Promise.try
if (typeof Promise.try !== 'function') {
  // eslint-disable-next-line no-eval
  eval(PROMISE_TRY_POLYFILL);
}

let workerSrcPromise: Promise<string> | undefined;

/** 取一个打了补丁的 worker 地址（只做一次） */
const getWorkerSrc = async (): Promise<string> => {
  if (workerSrcPromise === undefined) {
    workerSrcPromise = (async () => {
      const source = await (await fetch(workerUrl)).text();
      // worker 是自包含模块，去掉末尾的 export 后即可当作普通脚本跑
      const patched = PROMISE_TRY_POLYFILL + source.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '');
      return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
    })();
  }
  return workerSrcPromise;
};

type PdfMeta = {
  info?: { Title?: string, Author?: string, Subject?: string }
}

export class PdfParser extends BookParser {
  private readonly pdf: any;
  private readonly meta: PdfMeta;
  private readonly sourceName: string;
  private coverResolved = false;
  private coverUrl?: string;

  private constructor(pdf: any, meta: PdfMeta, sourceName: string) {
    super();
    this.pdf = pdf;
    this.meta = meta;
    this.sourceName = sourceName;
  }

  /** 从内存字节加载 */
  public static async loadFromBuffer(buffer: Uint8Array, sourceName = '') {
    pdfjs.GlobalWorkerOptions.workerSrc = await getWorkerSrc();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    if (!pdf || pdf.numPages <= 0) {
      throw newError('PDF 解析失败: 文件没有页面');
    }
    let meta: PdfMeta = {};
    try {
      meta = await pdf.getMetadata();
    } catch {
      meta = {};
    }
    return new PdfParser(pdf, meta, sourceName);
  }

  /** 从本地文件加载 */
  public static async loadFromFilePath(filepath: string) {
    const buffer = await readFile(filepath);
    return await PdfParser.loadFromBuffer(buffer, basename(filepath.replace(/\\/g, '/')));
  }

  public getBookName() {
    const title = this.meta.info?.Title;
    return Promise.resolve((title && title.trim()) || this.fallbackName());
  }

  public getAuthor() {
    return Promise.resolve(this.meta.info?.Author?.trim() || '');
  }

  public getIntro() {
    return Promise.resolve(this.meta.info?.Subject?.trim() || '');
  }

  /** PDF 按页渲染，走双页对开时正好两页并排 */
  protected getBookType(): 'comic' | 'text' {
    return 'comic';
  }

  public async getCoverImageUrl() {
    if (!this.coverResolved) {
      this.coverUrl = await this.renderPage(1);
      this.coverResolved = true;
    }
    return this.coverUrl;
  }

  public getChapterTitleList() {
    const titles: string[] = [];
    for (let i = 0; i < this.pdf.numPages; i++) {
      titles.push(`第${i + 1}页`);
    }
    return Promise.resolve(titles);
  }

  public async getChapterList() {
    const chapters: Chapter[] = [];
    for (let i = 0; i < this.pdf.numPages; i++) {
      const url = await this.renderPage(i + 1);
      chapters.push({
        title: `第${i + 1}页`,
        contents: url === undefined ? ['（本页渲染失败）'] : [`<img src="${url}"/>`]
      });
    }
    return chapters;
  }

  private fallbackName() {
    return this.sourceName.replace(/\.[^.]+$/, '').trim() || '未命名文档';
  }

  /** 渲染指定页（1 基）为 data URL */
  private async renderPage(pageNumber: number) {
    const page = await this.pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    let scale = TARGET_WIDTH / base.width;
    // 像素数超限时再降一档
    if (base.width * scale * base.height * scale > MAX_PIXELS) {
      scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    }
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return void 0;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    let quality = 0.85;
    let url = canvas.toDataURL('image/jpeg', quality);
    // 体积超标时逐步降质
    while (url.length > MAX_IMAGE_SIZE * 1.34 && quality > 0.3) {
      quality -= 0.15;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    return url;
  }
}
