import { ref } from 'vue';
import { Chapter } from '../../../core/book/book';

export type SearchHit = {
  /** 章节在 chapterList 里的下标（gotoChapter 用这个） */
  chapterIndex: number;
  chapterTitle: string;
  /** 段落在 textContent 数组里的下标，对应渲染出来的 div[data-index] */
  paragraphIndex: number;
  /** 已带 <mark> 的片段（HTML 已转义） */
  snippet: string;
};

/** 命中上限，避免大书一次刷出上万条把界面拖死 */
const MAX_HITS = 120;
/** 片段前后各保留的字数 */
const SNIPPET_PAD = 24;

/** 去标签取纯文本；顺便还原常见实体，保证 indexOf 的位置对得上 */
const toPlainText = (html: string) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const buildSnippet = (text: string, at: number, len: number) => {
  const start = Math.max(0, at - SNIPPET_PAD);
  const end = Math.min(text.length, at + len + SNIPPET_PAD);
  return (start > 0 ? '…' : '')
    + escapeHtml(text.slice(start, at))
    + `<mark>${escapeHtml(text.slice(at, at + len))}</mark>`
    + escapeHtml(text.slice(at + len, end))
    + (end < text.length ? '…' : '');
};

export const useReadSearch = () => {
  const keyword = ref('');
  const hits = ref<SearchHit[]>([]);
  const searching = ref(false);
  const searched = ref(false);
  const truncated = ref(false);
  /** 递增令牌：关键词一变，旧的那次搜索自动作废 */
  let token = 0;

  const reset = () => {
    token++;
    keyword.value = '';
    hits.value = [];
    searched.value = false;
    truncated.value = false;
    searching.value = false;
  };

  const run = async (pid: string, chapterList: Chapter[], word: string) => {
    const my = ++token;
    const kw = word.trim();
    truncated.value = false;
    if (!kw) {
      hits.value = [];
      searched.value = false;
      return;
    }
    searching.value = true;
    hits.value = [];
    const out: SearchHit[] = [];
    try {
      for (let ci = 0; ci < chapterList.length; ci++) {
        if (my !== token) {
          return;
        }
        const chapter = chapterList[ci];
        let entity = null;
        try {
          entity = await GLOBAL_DB.store.textContentStore.getByPidAndChapterUrl(pid, chapter.url);
        } catch (e) {
          continue;
        }
        if (!entity) {
          continue;
        }
        const paragraphs = entity.textContent || [];
        for (let pi = 0; pi < paragraphs.length; pi++) {
          const text = toPlainText(paragraphs[pi]);
          if (!text) {
            continue;
          }
          let from = 0;
          while (true) {
            const at = text.indexOf(kw, from);
            if (at < 0) {
              break;
            }
            out.push({
              chapterIndex: ci,
              chapterTitle: chapter.title,
              paragraphIndex: pi,
              snippet: buildSnippet(text, at, kw.length),
            });
            from = at + kw.length;
            if (out.length >= MAX_HITS) {
              truncated.value = true;
              break;
            }
          }
          if (out.length >= MAX_HITS) {
            break;
          }
        }
        if (out.length >= MAX_HITS) {
          break;
        }
        // 让出主线程，避免大书搜索时界面卡住
        await new Promise(r => setTimeout(r, 0));
      }
      if (my !== token) {
        return;
      }
      hits.value = out;
      searched.value = true;
    } finally {
      if (my === token) {
        searching.value = false;
      }
    }
  };

  return { keyword, hits, searching, searched, truncated, run, reset };
};
