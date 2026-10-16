<script setup lang="ts">
import {
  ElDivider,
  ElIcon
} from 'element-plus';
import { nextTick, onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { useScrollTopStore } from '../../store/scrolltop';
import { useWindowStore } from '../../store/window';
import { useSettingsStore } from '../../store/settings';
import { Font } from '../../core/font';
import { useTextContentStore } from '../../store/text-content';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { useScrollTop } from './hooks/scrolltop';
import { PagePath } from '../../core/window';
import { useMessage } from '../../hooks/message';
import { isNull, isUndefined } from '../../core/is';
import { useDetailStore } from '../../store/detail';
import { Menu, MenuItem } from '../../components';
import { useBookmarks } from './hooks/bookmarks';
import IconArrowLineUp from '../../assets/svg/icon-arrow-line-up.svg';
import IconArrowLineDown from '../../assets/svg/icon-arrow-line-down.svg';
import { useReadAloudStore } from '../../store/read-aloud';
import { useScrollToggleChapter } from './hooks/scroll-toggle-chapter';
import { useClipboard } from './hooks/clipboard';
import { BookshelfStoreEntity } from '../../core/database/database';

const route = useRoute();

const pid = String(route.query.pid);
const detailUrl = String(route.query.detailUrl);

const { currentChapter } = storeToRefs(useTextContentStore());
const { mainElement } = storeToRefs(useScrollTopStore());
const { scrollToTextContent } = useScrollTopStore();
const { calcReadProgress, onRefresh } = useWindowStore();
const { isDark } = storeToRefs(useWindowStore());
const { setBookmark, contents } = useBookmarks();
const { options } = useSettingsStore();
const { copyText } = useClipboard();

const {
  width,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  sectionSpacing,
  lineSpacing,
  bookmarkColorEven,
  bookmarkColorOdd,
  readAloudColor,
} = storeToRefs(useSettingsStore());

const {
  pageHeight,
} = useScrollToggleChapter();

onMounted(() => {
  nextTick(() => {
    calcReadProgress(mainElement.value);
  });
});
const { isRunningGetTextContent } = storeToRefs(useTextContentStore());
const { getTextContent, nextChapter, prevChapter } = useTextContentStore();

useScrollTop(pid, detailUrl);

const message = useMessage();
const { setCurrentReadIndex } = useDetailStore();
const { isSelectPlay, playerStatus } = storeToRefs(useReadAloudStore());
const { stop: readAloudStop } = useReadAloudStore();
onRefresh(PagePath.READ, () => {
  if (isNull(currentChapter.value)) {
    return;
  }
  readAloudStop();
  getTextContent(pid, currentChapter.value, true).then(() => {
    if (isNull(currentChapter.value) || isUndefined(currentChapter.value.index)) {
      setCurrentReadIndex(-1);
      GLOBAL_LOG.warn(`chapter index is undefined, pid:${pid}`, currentChapter.value);
      message.warning('无法获取章节索引');
    } else {
      setCurrentReadIndex(currentChapter.value.index);
    }
    scrollToTextContent(void 0, 'instant');
  }).catch(e => {
    message.error(e.message);
  });
});

/* ---------------- 双页对开 ---------------- */

/** 两栏之间的间距（模拟书脊） */
const SPREAD_GUTTER = 48;

const spreadMode = computed(() => (
  options.enableTwoPageSpread
  && !isRunningGetTextContent.value
  && !isNull(currentChapter.value)
));

const currentBook = ref<BookshelfStoreEntity | null>(null);
const bookType = computed(() => currentBook.value?.type || 'text');

const spreadEl = ref<HTMLElement>();
const pageIndex = ref(0);
const totalPages = ref(1);
const spreadTransform = ref('');

/** 读当前书籍信息，判断是漫画还是文本 */
onMounted(async () => {
  try {
    const all = await GLOBAL_DB.store.bookshelfStore.getAll();
    currentBook.value = (all || []).find(b => b.pid === pid && b.detailPageUrl === detailUrl) || null;
  } catch (e) {
    GLOBAL_LOG.warn('read page, load bookshelf type failed', e);
  }
});

/** 漫画双页：预取下一章的内容，与本页并排显示 */
const nextContents = ref('');
watch([spreadMode, currentChapter, bookType], async () => {
  nextContents.value = '';
  if (!spreadMode.value || bookType.value !== 'comic') {
    return;
  }
  const chapter = currentChapter.value;
  if (isNull(chapter) || isUndefined(chapter.index)) {
    return;
  }
  try {
    const all = await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(pid, detailUrl);
    const next = (all || []).find(c => c.chapter.index === chapter.index + 1);
    nextContents.value = next
      ? next.textContent.map((text, i) => `<div data-index="${i}">${text}</div>`).join('')
      : '';
  } catch (e) {
    GLOBAL_LOG.warn('read page, load next page failed', e);
  }
}, { immediate: true });

/** 按视口宽度计算栏宽，保证恰好两栏填满一屏 */
const applyColumnWidth = () => {
  const el = spreadEl.value;
  const viewport = el?.parentElement;
  if (!el || !viewport) {
    return;
  }
  const vw = viewport.clientWidth;
  if (vw <= 0) {
    return;
  }
  if (bookType.value === 'text') {
    const col = Math.max(240, (vw - SPREAD_GUTTER) / 2);
    el.style.columnWidth = `${col}px`;
    el.style.columnGap = `${SPREAD_GUTTER}px`;
  }
};

/** 根据内容总宽度重算页数，并修正当前页码 */
const recalcPages = () => {
  const el = spreadEl.value;
  const viewport = el?.parentElement;
  if (!el || !viewport) {
    return;
  }
  const vw = viewport.clientWidth;
  if (vw <= 0) {
    return;
  }
  applyColumnWidth();
  totalPages.value = Math.max(1, Math.round(el.scrollWidth / vw));
  pageIndex.value = Math.min(Math.max(0, pageIndex.value), totalPages.value - 1);
  updateTransform();
};

const updateTransform = () => {
  const el = spreadEl.value;
  const viewport = el?.parentElement;
  if (!el || !viewport) {
    return;
  }
  spreadTransform.value = `translateX(${-pageIndex.value * viewport.clientWidth}px)`;
};

const gotoPage = (index: number) => {
  const max = totalPages.value - 1;
  pageIndex.value = Math.min(Math.max(0, index), max);
  updateTransform();
};

const nextPage = () => gotoPage(pageIndex.value + 1);
const prevPage = () => gotoPage(pageIndex.value - 1);

const comicChapterTotal = computed(() => currentBook.value?.chapterList.length || 0);

/**
 * 漫画的双页本来就是并排渲染的，不需要位移；
 * 「下一页」应当前进两个章节（一个对开）。
 */
const onNextPage = async () => {
  if (bookType.value !== 'comic') {
    nextPage();
    return;
  }
  const index = currentChapter.value?.index;
  if (isUndefined(index) || index + 1 >= comicChapterTotal.value) {
    return;
  }
  await nextChapter(true);
  if (index + 2 < comicChapterTotal.value) {
    await nextChapter(true);
  }
};

const onPrevPage = async () => {
  if (bookType.value !== 'comic') {
    prevPage();
    return;
  }
  const index = currentChapter.value?.index;
  if (isUndefined(index) || index - 1 < 0) {
    return;
  }
  await prevChapter(true);
  await prevChapter(true);
};

const canGoNext = computed(() => {
  if (bookType.value === 'comic') {
    const index = currentChapter.value?.index;
    return !isUndefined(index) && index + 1 < comicChapterTotal.value;
  }
  return pageIndex.value < totalPages.value - 1;
});

const canGoPrev = computed(() => {
  if (bookType.value === 'comic') {
    const index = currentChapter.value?.index;
    return !isUndefined(index) && index - 1 >= 0;
  }
  return pageIndex.value > 0;
});

/** 换章时回到第一页 */
watch(currentChapter, () => {
  pageIndex.value = 0;
  nextTick(recalcPages);
});

/** 内容变化（含书签重绘）后重算页数 */
watch(contents, () => {
  if (!spreadMode.value) {
    return;
  }
  nextTick(recalcPages);
}, { immediate: true });

watch([spreadMode, nextContents], () => {
  if (!spreadMode.value) {
    return;
  }
  nextTick(recalcPages);
});

const onResize = () => {
  if (spreadMode.value) {
    recalcPages();
  }
};

onMounted(() => {
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeydown);

  // 点击章节会直接跳到阅读页，此时 currentChapter 与 contents 在挂载前就已就绪，
  // watch 不会触发，必须在挂载后主动算一次。延迟一次以避开布局未完成的时序。
  nextTick(() => {
    recalcPages();
    setTimeout(recalcPages, 200);
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKeydown);
});

/** 左右方向键翻页 */
const onKeydown = (e: KeyboardEvent) => {
  if (!spreadMode.value) {
    return;
  }
  if (e.key === 'ArrowLeft') {
    onPrevPage();
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    onNextPage();
    e.preventDefault();
  }
};

const pageLabel = computed(() => {
  if (!spreadMode.value) {
    return '';
  }
  if (bookType.value === 'comic') {
    const from = pageIndex.value * 2 + 1;
    const to = Math.min(totalPages.value * 2, from + 1);
    return to > from ? `第 ${from}-${to} 页` : `第 ${from} 页`;
  }
  return `第 ${pageIndex.value + 1} 屏 / 共 ${totalPages.value} 屏`;
});

</script>

<template>
  <div :class="['container', isRunningGetTextContent ? 'loading' : '']" v-loading="isRunningGetTextContent" :style="{
    '--font-family': `'${fontFamily === '' ? Font.default : fontFamily}'`
  }">
    <div v-if="options.enableScrollToggleChapter && !isRunningGetTextContent && !spreadMode" class="scroll-top-to-prev-chapter">
      <p>向上滚动切换上一章节</p>
      <ElIcon size="60">
        <IconArrowLineUp />
      </ElIcon>
    </div>
    <div class="reader-stage" :class="{ spread: spreadMode }">
      <div v-if="spreadMode && bookType === 'comic'" id="text-content" class="spread-comic">
        <div class="spread-page" v-html="contents"></div>
        <div class="spread-page" v-html="nextContents"></div>
      </div>
      <div v-else id="text-content" v-show="!isRunningGetTextContent" v-html="contents" ref="spreadEl" :style="{
        width,
        minHeight: pageHeight,
        fontSize,
        fontWeight,
        transform: spreadMode ? spreadTransform : '',
        '--rc-read-aloud-color': isDark ? '' : readAloudColor,
        '--rc-bookmark-odd-color': isDark ? '' : bookmarkColorOdd,
        '--rc-bookmark-even-color': isDark ? '' : bookmarkColorEven,
        '--rc-bookmark-odd-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorOdd : '',
        '--rc-bookmark-even-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorEven : '',
      }" :class="[spreadMode ? 'spread-text' : '', isSelectPlay && playerStatus === 'pause' ? 'play-start' : '']"></div>
    </div>
    <div v-if="spreadMode" class="spread-nav">
      <button @click="onPrevPage" :disabled="!canGoPrev">
        <ElIcon size="18"><IconArrowLineUp /></ElIcon>
      </button>
      <span>{{ pageLabel }}</span>
      <button @click="onNextPage" :disabled="!canGoNext">
        <ElIcon size="18"><IconArrowLineDown /></ElIcon>
      </button>
    </div>
    <div v-if="options.enableScrollToggleChapter && !isRunningGetTextContent && !spreadMode" class="scroll-bottom-to-next-chapter">
      <ElIcon size="60">
        <IconArrowLineDown />
      </ElIcon>
      <p>向下滚动切换下一章节</p>
    </div>
    <Menu trigger="#main" class-name="read-menu" :disabled="isRunningGetTextContent">
      <MenuItem label="上一章" @click="prevChapter(true)" />
      <MenuItem label="下一章" @click="nextChapter(true)" />
      <ElDivider v-once />
      <MenuItem label="设置书签" @click="setBookmark" />
      <MenuItem label="复制" @click="copyText" />
    </Menu>
  </div>
</template>

<style lang="scss">
.read-menu {
  .el-divider {
    margin: 5px 0 4px 0;
  }
}
</style>
<style scoped lang="scss">
.loading.container {
  overflow: hidden;

  #text-content {
    height: 0;
  }
}

.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--rc-text-color);

  :deep(.el-loading-mask) {
    height: 100vh;
    background-color: var(--rc-header-color) !important;
  }

  .reader-stage {
    width: 100%;
    display: flex;
    justify-content: center;

    &.spread {
      overflow: hidden;
      height: v-bind(pageHeight);
      align-items: flex-start;
    }
  }

  #text-content {
    * {
      font-family: var(--font-family);
    }

    &.spread-text {
      height: 100%;
      column-fill: auto;
      break-inside: avoid;

      > :deep(div[data-index]) {
        break-inside: avoid;
      }
    }

    &.spread-comic {
      display: flex;
      gap: 48px;
      height: 100%;
      width: 100%;
      align-items: stretch;

      .spread-page {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        height: 100%;
        overflow: hidden;
      }

      :deep(img) {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        align-self: center;
      }
    }

    &.play-start {
      :deep(div[data-index]) {
        &:hover {
          color: var(--rc-read-aloud-color);
          cursor: pointer;
        }
      }
    }
    &>:deep(div[data-index]) {
      margin-bottom: v-bind(sectionSpacing);
      text-indent: 2em;
      letter-spacing: v-bind(letterSpacing);
      line-height: v-bind(lineSpacing);
      user-select: text;
      cursor: default;
      transition: color 0.3s ease;
      overflow: hidden;
      contain: layout;
      
      .bookmark {
        border-bottom: 1.5px solid var(--rc-bookmark-odd-color);
        color: var(--rc-bookmark-odd-font-color);
        cursor: pointer;
        user-select: text;

        &.even {
          border-bottom: 1.5px solid var(--rc-bookmark-even-color);
          color: var(--rc-bookmark-even-font-color);
        }
      }

      &.current-read-aloud {
        color: var(--rc-read-aloud-color);
      }

      &:first-child {
        display: none;
      }

      &:last-child {
        margin-bottom: 0;
      }

      * {
        max-width: 100%;
        user-select: text;
      }
    }
  }

  .spread-nav {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 10px 0;
    font-size: 13px;
    color: var(--rc-text-secondary, #5F5E5A);

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.3));
      border-radius: 8px;
      background: transparent;
      cursor: pointer;

      .read-page-prev & {
        transform: rotate(-90deg);
      }

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }
  }

  .scroll-bottom-to-next-chapter,
  .scroll-top-to-prev-chapter {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: v-bind(pageHeight);
  }
  .scroll-bottom-to-next-chapter {
    padding-top: 50px;
  }
  .scroll-top-to-prev-chapter {
    padding-bottom: 50px;
    justify-content: flex-end;
  }
}
</style>
