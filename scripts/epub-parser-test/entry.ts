/**
 * EpubParser 端到端验证入口
 *
 * 该文件由 build.mjs 用 esbuild 打包后，注入到 Electron 渲染进程执行，
 * 目的是在真实的 Chromium DOMParser 环境下验证解析结果（而非 jsdom 之类的近似实现）。
 */

import JSZip from 'jszip';
import { EpubParser } from '../../src/core/book/epub-parser';
import { bytesToBase64 } from '../../src/core/book/epub-parser/utils';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** base64 转字节，避免依赖 Node 的 Buffer */
const base64ToBytes = (val: string) => {
  const binary = atob(val);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
};

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// 刻意使用 opf:/dc: 前缀，验证解析器不依赖命名空间前缀
const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"
  version="3.0" unique-identifier="bookid">
  <opf:metadata>
    <dc:title>测试书籍</dc:title>
    <dc:creator>张三</dc:creator>
    <dc:description>这是一本&lt;b&gt;测试&lt;/b&gt;用的书</dc:description>
    <dc:language>zh-CN</dc:language>
    <opf:meta name="cover" content="cover-img"/>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <opf:item id="pic1" href="images/pic%20with%20space.png" media-type="image/png"/>
    <opf:item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <opf:item id="coverpage" href="text/coverpage.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="c3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine toc="ncx">
    <opf:itemref idref="coverpage" linear="no"/>
    <opf:itemref idref="c1"/>
    <opf:itemref idref="c2"/>
    <opf:itemref idref="c3"/>
  </opf:spine>
  <opf:guide>
    <reference type="cover" href="images/cover.png" title="封面"/>
  </opf:guide>
</opf:package>`;

const ncxXml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>NCX 第一章</text></navLabel>
      <content src="text/chapter1.xhtml"/>
    </navPoint>
    <navPoint id="n2" playOrder="2">
      <navLabel><text>NCX 第二章</text></navLabel>
      <content src="text/chapter2.xhtml#top"/>
    </navPoint>
  </navMap>
</ncx>`;

// nav 与 NCX 对第二章给出不同标题，用于验证 nav 优先级
const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/chapter2.xhtml">NAV 第二章</a></li>
    </ol>
  </nav>
</body>
</html>`;

const coverPageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>封面页</title></head>
<body><div><img src="../images/cover.png" alt="封面"/></div></body>
</html>`;

const chapter1Xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第一章 起风了</title></head>
<body>
  <h1>第一章 起风了</h1>
  <p>第一段文字，包含 &amp; 符号与&#160;空格。</p>
  <div>
    <p>嵌套在 div 里的段落。</p>
    <p>另一段。</p>
  </div>
  <p>这里有一张图：<img src="../images/pic%20with%20space.png" alt="插图"/></p>
  <blockquote>引用的内容</blockquote>
  <p>行一<br/>行二</p>
  <p><em>斜体</em>与<strong>加粗</strong></p>
  <p>&#160;</p>
  <script>alert(1)</script>
  <p>指向外部站点的图片应被丢弃：<img src="https://example.com/x.png"/></p>
</body>
</html>`;

const chapter2Xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>第二章 无题</title></head>
<body>
  <p>第二章正文。</p>
  <svg viewBox="0 0 10 10"><image xlink:href="../images/pic%20with%20space.png" width="10" height="10"/></svg>
  <img src="../images/pic%20with%20space.png" alt="裸图"/>
</body>
</html>`;

// 故意写成非良构 XHTML，验证 HTML 回退分支
const chapter3Malformed = `<html>
<head><title>第三章 容错测试</title></head>
<body><p>第三章 &nbsp; 含未闭合标签<p>第二段<em>未闭合的斜体
</body></html>`;

const buildEpub = async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OEBPS/content.opf', opfXml);
  zip.file('OEBPS/toc.ncx', ncxXml);
  zip.file('OEBPS/nav.xhtml', navXhtml);
  zip.file('OEBPS/text/coverpage.xhtml', coverPageXhtml);
  zip.file('OEBPS/text/chapter1.xhtml', chapter1Xhtml);
  zip.file('OEBPS/text/chapter2.xhtml', chapter2Xhtml);
  zip.file('OEBPS/text/chapter3.xhtml', chapter3Malformed);
  const png = base64ToBytes(PNG_1X1);
  zip.file('OEBPS/images/cover.png', png);
  zip.file('OEBPS/images/pic with space.png', png);
  return await zip.generateAsync({ type: 'uint8array' });
};

const isDataUrl = (val: string | undefined, mime: string) => {
  return typeof val === 'string' && val.startsWith(`data:${mime};base64,`);
};

/** 把结果以 base64 写入 DOM，避免 --dump-dom 序列化时转义特殊字符 */
const writeResult = (payload: unknown) => {
  const json = JSON.stringify(payload);
  console.log('__RESULT__' + json);
  const out = document.createElement('pre');
  out.id = 'rc-test-result';
  out.textContent = bytesToBase64(new TextEncoder().encode(json));
  document.body.appendChild(out);
}

/** 真实 epub 冒烟测试的概要信息，便于人工核对解析质量 */
const summary: Record<string, unknown> = {};

/** 用 fixtures 目录下的真实 epub 做一次冒烟测试 */
const runRealFixture = async () => {
  const fixture = (window as any).__EPUB_FIXTURE__ as string | undefined;
  if (typeof fixture !== 'string' || fixture === '') {
    summary.realFixture = '未提供 fixture.js，已跳过';
    return;
  }
  const parser = await EpubParser.loadFromBuffer(base64ToBytes(fixture), 'pg1342.epub');
  const bookname = await parser.getBookName();
  const author = await parser.getAuthor();
  const cover = await parser.getCoverImageUrl();
  const titles = await parser.getChapterTitleList();
  const chapters = await parser.getChapterList();
  const totalBlocks = chapters.reduce((prev, curr) => prev + curr.contents.length, 0);
  const emptyChapters = chapters.filter(c => c.contents.length <= 0).map(c => c.title);
  check('真实 epub: 书名解析成功', bookname.trim() !== '', `实际: ${bookname}`);
  check('真实 epub: 作者解析成功', author.trim() !== '', `实际: ${author}`);
  check('真实 epub: 封面转成 data URL', typeof cover === 'string' && cover.startsWith('data:image/'), `实际: ${String(cover).slice(0, 40)}`);
  check('真实 epub: 章节数大于 10', chapters.length > 10, `实际: ${chapters.length}`);
  check('真实 epub: 正文段落总数大于 100', totalBlocks > 100, `实际: ${totalBlocks}`);
  check('真实 epub: 无空章节', emptyChapters.length === 0, `空章节: ${JSON.stringify(emptyChapters)}`);
  check('真实 epub: 章节标题均非空', titles.every(t => t.trim() !== ''), `实际: ${JSON.stringify(titles)}`);
  check('真实 epub: 无 script/style 残留', !chapters.some(c => c.contents.some(v => /<script|<style/i.test(v))), '存在残留');
  summary.realFixture = {
    bookname,
    author,
    chapterCount: chapters.length,
    totalBlocks,
    coverLength: cover ? cover.length : 0,
    titles: titles.slice(0, 6),
    firstChapterSample: chapters[0]?.contents.slice(0, 4)
  };
}

const run = async () => {
  try {
    const bytes = await buildEpub();
    const parser = await EpubParser.loadFromBuffer(bytes, '测试书籍.epub');

    const bookname = await parser.getBookName();
    check('书名取自 dc:title', bookname === '测试书籍', `实际: ${bookname}`);

    const author = await parser.getAuthor();
    check('作者取自 dc:creator', author === '张三', `实际: ${author}`);

    const intro = await parser.getIntro();
    check('简介去除内嵌标签', intro === '这是一本测试用的书', `实际: ${intro}`);

    const cover = await parser.getCoverImageUrl();
    check('封面解析为 data URL', isDataUrl(cover, 'image/png'), `实际: ${String(cover).slice(0, 40)}`);

    const titles = await parser.getChapterTitleList();
    check('章节数为 3（linear="no" 的封面页被跳过）', titles.length === 3, `实际: ${JSON.stringify(titles)}`);
    check('第一章标题取自 NCX', titles[0] === 'NCX 第一章', `实际: ${titles[0]}`);
    check('第二章标题被 nav 覆盖', titles[1] === 'NAV 第二章', `实际: ${titles[1]}`);
    check('第三章标题回退到 <title>', titles[2] === '第三章 容错测试', `实际: ${titles[2]}`);

    const chapters = await parser.getChapterList();
    const c1 = chapters[0].contents;
    check('第一章拆出 9 个段落', c1.length === 9, `实际 ${c1.length}: ${JSON.stringify(c1)}`);
    check('标题段落保留', c1[0] === '第一章 起风了', `实际: ${c1[0]}`);
    check('纯文本段落转义实体', c1[1] === '第一段文字，包含 &amp; 符号与 空格。', `实际: ${c1[1]}`);
    check('div 内段落被拆开', c1[2] === '嵌套在 div 里的段落。' && c1[3] === '另一段。', `实际: ${JSON.stringify(c1.slice(2, 4))}`);
    check('含图段落内嵌 data URL', c1[4].includes('<img src="data:image/png;base64,') && c1[4].startsWith('这里有一张图：'), `实际: ${c1[4].slice(0, 80)}`);
    check('blockquote 段落保留', c1[5] === '引用的内容', `实际: ${c1[5]}`);
    check('br 换行被保留', c1[6] === '行一<br/>行二', `实际: ${c1[6]}`);
    check('纯文本段落不残留行内标签', c1[7] === '斜体与加粗', `实际: ${c1[7]}`);
    check('外部图片被丢弃且段落保留', c1[8] === '指向外部站点的图片应被丢弃：', `实际: ${c1[8]}`);
    check('script 内容未被输出', !c1.some(v => v.includes('alert')), `实际: ${JSON.stringify(c1)}`);
    check('空白段落被丢弃', !c1.some(v => v.trim() === ''), `实际: ${JSON.stringify(c1)}`);

    const c2 = chapters[1].contents;
    check('svg 包装的图片被转成 img', c2.length === 3 && c2[1].startsWith('<img src="data:image/png;base64,'), `实际: ${JSON.stringify(c2)}`);
    check('body 下的裸 img 未被丢弃', c2[2].startsWith('<img src="data:image/png;base64,') && c2[2].endsWith('alt="裸图"/>'), `实际: ${c2[2]}`);

    const c3 = chapters[2].contents;
    check('非良构 XHTML 回退解析后仍有正文', c3.length > 0 && c3.join('').includes('第三章'), `实际: ${JSON.stringify(c3)}`);

    await runRealFixture();
  } catch (e: any) {
    check('解析过程未抛异常', false, `${e && e.message ? e.message : String(e)}`);
  }
  writeResult({
    total: results.length,
    failed: results.filter(r => !r.ok).length,
    summary,
    results
  });
}

run().catch(e => {
  writeResult({
    total: results.length + 1,
    failed: 1,
    summary,
    results: [...results, { name: '测试入口异常', ok: false, detail: `${e && e.stack ? e.stack : String(e)}` }]
  });
});
