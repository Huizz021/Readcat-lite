import { defineStore } from 'pinia';
import { BookshelfStoreEntity } from '../core/database/database';
import { useMessage } from '../hooks/message';
import { errorHandler, newError, replaceInvisibleStr } from '../core/utils';
import { isUndefined } from '../core/is';
import { BookParser } from '../core/book/book-parser';

export type Book = {
  id: string,
  pid: string,
  detailPageUrl: string,
  bookname: string,
  author: string,
  coverImageUrl: string,
  latestChapterTitle?: string,
  searchIndex: string,
  readIndex: number,
  readChapterTitle: string,
  timestamp: number,
  pluginVersionCode: number,
  baseUrl: string,
  group: string,
  pluginName: string
}
export type BookRefresh = {
  error?: string,
} & Book;

export const useBookshelfStore = defineStore('Bookshelf', {
  state: () => {
    return {
      _books: new Map<string, BookRefresh>(),
      currentPage: 1,
    }
  },
  getters: {
    books(): BookRefresh[] {
      this._books.size <= 0 && (this.currentPage = 1);
      return Array.from(this._books.values()).sort((a, b) => b.timestamp - a.timestamp);
    },
  },
  actions: {
    async getBookshelfEntity(pid: string, detailPageUrl: string) {
      try {
        return await GLOBAL_DB.store.bookshelfStore.getByPidAndDetailPageUrl(pid, detailPageUrl);
      } catch (e: any) {
        useMessage().error(e.message);
        return errorHandler(e);
      }
    },
    exist(pid: string, detailPageUrl: string) {
      return Array.from(this._books.values())
        .findIndex(v => v.pid === pid && v.detailPageUrl === detailPageUrl)
        >= 0;
    },
    async put(entity: BookshelfStoreEntity): Promise<void> {
      try {
        const _entity = replaceInvisibleStr(entity);
        if (!entity.id.trim()) {
          throw newError('ID为空');
        }
        if (!entity.pid.trim() || !entity.detailPageUrl.trim()) {
          throw newError('PID或DetailUrl为空');
        }
        const {
          id,
          pid,
          detailPageUrl,
          bookname,
          author,
          coverImageUrl,
          chapterList,
          latestChapterTitle,
          searchIndex,
          readIndex,
          timestamp,
          pluginVersionCode,
          baseUrl
        } = _entity;
        const props = GLOBAL_PLUGINS.getPluginPropsById(pid);
        let GROUP, NAME;
        if (pid !== BookParser.PID) {
          if (isUndefined(props)) throw newError('插件属性获取失败');
          GROUP = props.GROUP;
          NAME = props.NAME;
        } else {
          GROUP = '内置';
          NAME = '本地书籍';
        }
        const obj: Book = {
          id,
          pid,
          detailPageUrl,
          bookname,
          author,
          coverImageUrl,
          latestChapterTitle,
          searchIndex,
          readIndex,
          readChapterTitle: chapterList[readIndex]?.title,
          timestamp,
          pluginVersionCode,
          baseUrl,
          group: GROUP,
          pluginName: NAME
        };
        await GLOBAL_DB.store.bookshelfStore.put(_entity);
        this._books.set(id, {
          error: void 0,
          ...obj
        });
      } catch (e: any) {
        useMessage().error(e.message);
        return errorHandler(e);
      }
    },
    async remove(id: string): Promise<void> {
      try {
        if (this._books.has(id)) {
          await GLOBAL_DB.store.bookshelfStore.remove(id);
          this._books.delete(id);
        }
      } catch (e: any) {
        useMessage().error(e.message);
        return errorHandler(e);
      }
    },
    async removeByPidAndDetailUrl(pid: string, detailUrl: string): Promise<void> {
      try {
        const entity = Array.from(this._books.values()).find(v => v.pid === pid && v.detailPageUrl === detailUrl);
        if (entity) {
          await GLOBAL_DB.store.bookshelfStore.remove(entity.id);
          this._books.delete(entity.id);
        }
      } catch (e: any) {
        useMessage().error(e.message);
        return errorHandler(e);
      }
    },
  }
});