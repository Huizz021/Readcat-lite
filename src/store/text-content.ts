import { defineStore, storeToRefs } from 'pinia';
import { Chapter } from '../core/book/book';
import { errorHandler, newError } from '../core/utils';
import { isNull, isUndefined } from '../core/is';
import { nextTick } from 'vue';
import { useDetailStore } from './detail';
import { useMessage } from '../hooks/message';
import { useWindowStore } from './window';
import { PagePath } from '../core/window';
import { useScrollTopStore } from './scrolltop';
import { useBookshelfStore } from './bookshelf';
import { useReadAloudStore } from './read-aloud';

export type TextContent = {
  contents: string[],
  length: number
}

export type TextContentEvent = 'chapterchange';

export const useTextContentStore = defineStore('TextContent', {
  state: () => {
    return {
      textContent: null as TextContent | null,
      isRunningGetTextContent: false,
      currentChapter: null as Chapter | null,
      events: new Map<TextContentEvent, () => void>(),
    }
  },
  getters: {
  },
  actions: {
    on(type: TextContentEvent, listener: () => void) {
      this.events.set(type, listener);
    },
    async handlerChapter(type: 'next' | 'prev') {
      const detailStore = useDetailStore();
      const { setCurrentReadIndex, currentReadScrollTop } = detailStore;
      const { detailResult, currentDetailUrl, currentPid } = storeToRefs(detailStore);
      const { exist, getBookshelfEntity, put } = useBookshelfStore();
      const { calcReadProgress } = useWindowStore();
      const { scrollToTextContent } = useScrollTopStore();
      const readAloud = useReadAloudStore();
      const isPause = readAloud.playerStatus === 'pause';
      const message = useMessage();
      try {
        if (this.isRunningGetTextContent) {
          throw newError('正在获取章节正文');
        }
        if (isNull(detailResult.value) || detailResult.value.chapterList.length <= 0) {
          throw newError('无法获取章节列表');
        }
        if (isNull(this.currentChapter)) {
          throw newError('无法获取当前章节信息');
        }
        if (isNull(currentPid.value)) {
          throw newError('无法获取插件ID');
        }
        let index;
        if (type === 'next') {
          index = this.currentChapter.index + 1;
          if (index >= detailResult.value.chapterList.length) {
            message.warning('当前已是最后一章');
            throw null;
          }
        } else if (type === 'prev') {
          index = this.currentChapter.index - 1;
          if (index < 0) {
            message.warning('当前已是第一章');
            throw null;
          }
        } else {
          throw newError('未知类型');
        }
        const chapter = detailResult.value.chapterList[index];
        await this.getTextContent(currentPid.value, chapter);
        calcReadProgress();
        setCurrentReadIndex(index);
        currentReadScrollTop.chapterIndex = index;
        currentReadScrollTop.scrollTop = 0;
        readAloud.stop();
        if (!isPause) {
          readAloud.play(0);
        }
        if (isNull(currentPid.value) || isNull(currentDetailUrl.value) || isNull(detailResult.value)) {
          return;
        }
        if (!exist(currentPid.value, currentDetailUrl.value)) {
          return;
        }
        getBookshelfEntity(currentPid.value, currentDetailUrl.value).then(entity => {
          if (!entity) {
            return;
          }
          put({
            ...entity,
            readIndex: chapter.index,
            readScrollTop: 0
          });
        });
      } catch (e) {
        e && message.error(errorHandler(e, true));
        return e ? errorHandler(e) : Promise.reject();
      } finally {
        scrollToTextContent();
      }
    },
    async nextChapter(ignoreError = false) {
      const listener = this.events.get('chapterchange');
      await this.handlerChapter('next')
        .then(() => listener && listener())
        .catch(e => ignoreError ? Promise.resolve() : Promise.reject(e));
    },
    async prevChapter(ignoreError = false) {
      const listener = this.events.get('chapterchange');
      await this.handlerChapter('prev')
        .then(() => listener && listener())
        .catch(e => ignoreError ? Promise.resolve() : Promise.reject(e));
    },
    /**
     * 跳到指定章节（全文搜索的跳转用）。
     * 与 handlerChapter 的区别只是索引由调用方给定，而不是当前章节 ±1。
     */
    async gotoChapter(index: number, ignoreError = false) {
      const detailStore = useDetailStore();
      const { setCurrentReadIndex, currentReadScrollTop } = detailStore;
      const { detailResult, currentPid, currentDetailUrl } = storeToRefs(detailStore);
      const { exist, getBookshelfEntity, put } = useBookshelfStore();
      const { calcReadProgress } = useWindowStore();
      const { scrollToTextContent } = useScrollTopStore();
      const readAloud = useReadAloudStore();
      const message = useMessage();
      const listener = this.events.get('chapterchange');
      try {
        if (this.isRunningGetTextContent) {
          throw newError('正在获取章节正文');
        }
        if (isNull(detailResult.value) || detailResult.value.chapterList.length <= 0) {
          throw newError('无法获取章节列表');
        }
        if (isNull(currentPid.value)) {
          throw newError('无法获取插件ID');
        }
        if (index < 0 || index >= detailResult.value.chapterList.length) {
          throw newError('章节索引超出范围');
        }
        if (!isNull(this.currentChapter) && this.currentChapter.index === index) {
          listener && listener();
          return;
        }
        const chapter = detailResult.value.chapterList[index];
        await this.getTextContent(currentPid.value, chapter);
        calcReadProgress();
        setCurrentReadIndex(index);
        currentReadScrollTop.chapterIndex = index;
        currentReadScrollTop.scrollTop = 0;
        readAloud.stop();
        if (!isNull(currentPid.value) && !isNull(currentDetailUrl.value) && exist(currentPid.value, currentDetailUrl.value)) {
          getBookshelfEntity(currentPid.value, currentDetailUrl.value).then(entity => {
            if (!entity) {
              return;
            }
            put({ ...entity, readIndex: chapter.index, readScrollTop: 0 });
          });
        }
        listener && listener();
      } catch (e) {
        e && message.error(errorHandler(e, true));
        if (!ignoreError) {
          throw e;
        }
      } finally {
        scrollToTextContent();
      }
    },
    async getTextContent(pid: string, chapter: Chapter): Promise<void> {
      const win = useWindowStore();
      try {
        if (this.isRunningGetTextContent) {
          return;
        }
        this.isRunningGetTextContent = true;
        this.textContent = null;
        this.currentChapter = null;
        win.disableShowSearchBox.set(PagePath.READ, true);
        win.disableShowSearchBox.set(PagePath.DETAIL, true);
        const dbTextContent = await GLOBAL_DB.store.textContentStore.getByPidAndChapterUrl(pid, chapter.url);
        this.currentChapter = chapter;
        if (!dbTextContent) {
          throw newError('无法获取章节内容');
        }
        const { chapter: cachedChapter, textContent } = dbTextContent;
        const lengths = textContent.map(t => t.length);
        this.textContent = {
          contents: [cachedChapter.title, ...textContent],
          length: lengths.length > 0 ? lengths.reduce((prev, curr) => prev + curr) : 0
        };
        return;
      } catch (e) {
        GLOBAL_LOG.error('Text Content Store getTextContent', e);
        return errorHandler(e);
      } finally {
        nextTick(() => {
          this.isRunningGetTextContent = false;
          win.disableShowSearchBox.set(PagePath.READ, false);
          win.disableShowSearchBox.set(PagePath.DETAIL, false);
          useScrollTopStore().scrollToTextContent(void 0, 'instant');
        });
      }
    },


    async removeTextContentsByPidAndDetailUrl(pid: string, detailUrl: string): Promise<void> {
      try {
        await GLOBAL_DB.store.textContentStore.removeByPidAndDetailUrl(pid, detailUrl);
        const { cacheIndexs } = storeToRefs(useDetailStore());
        GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(pid, detailUrl).then(res => {
          const indexs = res?.map(v => v.chapter.index);
          cacheIndexs.value[detailUrl] = isUndefined(indexs) ? [] : indexs;
        });
      } catch (e) {
        useMessage().error(errorHandler(e, true));
        return errorHandler(e);
      }
    },
  }
});