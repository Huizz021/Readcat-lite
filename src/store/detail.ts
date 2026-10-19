import { defineStore } from 'pinia';
import { isNull, isNumber, isUndefined } from '../core/is';
import { DetailEntity } from '../core/book/book';
import { useWindowStore } from './window';
import { PagePath } from '../core/window';
import { useBookshelfStore } from './bookshelf';
import { BookParser } from '../core/book/book-parser';
import { nextTick } from 'vue';

export interface DetailPageResult extends DetailEntity {
  pid: string,
  pluginVersionCode: number,
  baseUrl: string
}

export const useDetailStore = defineStore('Detail', {
  state: () => {
    return {
      detailResult: null as DetailPageResult | null,
      isRunningGetDetailPage: false,
      error: null as string | null,
      currentDetailUrl: null as string | null,
      currentPage: 1,
      currentReadIndex: -1,
      currentReadScrollTop: {
        chapterIndex: 0,
        scrollTop: 0
      },
      cacheIndexs: {} as Record<string, number[]>,
      currentPid: null as string | null,
    }
  },
  getters: {

  },
  actions: {
    setCurrentReadIndex(index: number) {
      if (isNumber(index)) {
        this.currentReadIndex = index;
      } else {
        this.currentReadIndex = -1;
      }
    },
    async getDetailPage(pid: string, url: string, _refresh = false): Promise<void> {
      const win = useWindowStore();
      const bookshelf = useBookshelfStore();
      try {
        if (this.isRunningGetDetailPage) {
          return;
        }
        this.isRunningGetDetailPage = true;
        win.disableShowSearchBox.set(PagePath.DETAIL, true);
        this.detailResult = null;
        this.error = null;
        this.currentDetailUrl = null;
        this.currentPid = null;
        this.cacheIndexs[url] = [];
        const BASE_URL = BookParser.BASE_URL;
        const book = await GLOBAL_DB.store.bookshelfStore.getByPidAndDetailPageUrl(pid, url);
        if (isNull(book)) {
          this.error = '无法获取详情页';
          return;
        }
        await bookshelf.put({
          ...book,
          timestamp: Date.now()
        });
        const cacheIndexs = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(pid, url))?.map(v => v.chapter.index);
        this.cacheIndexs[url] = isUndefined(cacheIndexs) ? [] : cacheIndexs;
        if (book.baseUrl !== BASE_URL) {
          this.error = '数据来源不匹配, 请重新导入';
          return;
        }
        this.detailResult = book;
        this.setCurrentReadIndex(book.readIndex);
        this.currentReadScrollTop = {
          chapterIndex: book.readIndex,
          scrollTop: book.readScrollTop
        };
        this.currentDetailUrl = url;
        this.currentPid = pid;
      } catch (e: any) {
        GLOBAL_LOG.error('Detail store getDetailPage', e);
        this.error = e.message;
        return;
      } finally {
        nextTick(() => {
          this.isRunningGetDetailPage = false;
          win.disableShowSearchBox.set(PagePath.DETAIL, false);
        });
      }
    }
  }
});