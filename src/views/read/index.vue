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
import { BookshelfStoreEntity, TextContentStoreEntity } from '../../core/database/database';

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

const SPREAD_GUTTER = 40;
/** 翻页动画时长（毫秒），与 CSS 里的 transition 保持一致 */
const FLIP_DURATION = 280;

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

/** 漫画的翻页轨道：slides[0] 当前对开，slides[1] 邻近对开 */
const comicSlides = ref<string[]>(['', '']);
const comicOffset = ref(0);
const comicAnimated = ref(false);
const comicBusy = ref(false);

/** 读当前书籍信息，判断是漫画还是文本 */
onMounted(async () => {
  try {
    const all = await GLOBAL_DB.store.bookshelfStore.getAll();
    currentBook.value = (all || []).find(b => b.pid === pid && b.detailPageUrl === detailUrl) || null;
  } catch (e) {
    GLOBAL_LOG.warn('read page, load bookshelf type failed', e);
  }
});

const comicChapterTotal = computed(() => currentBook.value?.chapterList.length || 0);

const toSlideHtml = (entity: TextContentStoreEntity) => {
  return `<div class="spread-page">${entity.textContent.map((text, i) => `<div data-index="${i}">${text}</div>`).join('')}</div>`;
};

/**
 * 取「以 start 开始的两页」拼成一个对开。
 * 右页不存在（书末尾）时返回单页，由样式层居中处理。
 */
const buildSpread = async (start: number): Promise<string> => {
  const all = (await GLOBAL_DB.store.textContentStore.getByPidAndDetailUrl(pid, detailUrl)) || [];
  const left = all.find(c => c.chapter.index === start);
  const right = all.find(c => c.chapter.index === start + 1);
  return (left ? toSlideHtml(left) : '') + (right ? toSlideHtml(right) : '');
};

/** 用当前章节同步轨道：slides = [当前对开, 下一对开]，停在第一张 */
const syncComicSlides = async () => {
  if (!spreadMode.value || bookType.value !== 'comic') {
    comicSlides.value = ['', ''];
    return;
  }
  const index = currentChapter.value?.index;
  if (isUndefined(index)) {
    return;
  }
  try {
    const current = await buildSpread(index);
    const next = index + 2 < comicChapterTotal.value ? await buildSpread(index + 2) : '';
    comicSlides.value = [current, next];
  } catch (e) {
    GLOBAL_LOG.warn('read page, sync comic slides failed', e);
  }
};

watch([spreadMode, currentChapter, bookType], () => {
  comicAnimated.value = false;
  comicOffset.value = 0;
  comicBusy.value = false;
  syncComicSlides();
}, { immediate: true });

const comicTrack = ref<HTMLElement>();

/**
 * 翻页动画结束时提交章节切换。
 * 不用 transitionend —— 它在部分环境下不触发，改用固定时长的定时器。
 */
const commitFlip = (goingNext: boolean, index: number) => {
  window.setTimeout(async () => {
    try {
      if (goingNext) {
        await nextChapter(true);
        if (index + 2 < comicChapterTotal.value) {
          await nextChapter(true);
        }
      } else {
        await prevChapter(true);
        await prevChapter(true);
      }
    } catch (e) {
      GLOBAL_LOG.warn('read page, comic flip commit failed', e);
    } finally {
      comicAnimated.value = false;
      comicOffset.value = 0;
      comicBusy.value = false;
    }
  }, FLIP_DURATION + 30);
};

const onNextPage = () => {
  if (!spreadMode.value) {
    return;
  }
  if (bookType.value !== 'comic') {
    gotoPage(pageIndex.value + 1);
    return;
  }
  const index = currentChapter.value?.index;
  if (isUndefined(index) || comicBusy.value || index + 1 >= comicChapterTotal.value) {
    return;
  }
  comicBusy.value = true;
  comicAnimated.value = true;
  // translateX 的百分比相对轨道自身宽度（轨道是 200%），所以半屏是 -50%
  comicOffset.value = -50;
  commitFlip(true, index);
};

const onPrevPage = async () => {
  if (!spreadMode.value) {
    return;
  }
  if (bookType.value !== 'comic') {
    gotoPage(pageIndex.value - 1);
    return;
  }
  const index = currentChapter.value?.index;
  if (isUndefined(index) || comicBusy.value || index - 1 < 0) {
    return;
  }
  comicBusy.value = true;
  try {
    // 把「上一对开」放到第二张，先无动画跳过去，再滑回来
    const prev = await buildSpread(index - 2);
    comicAnimated.value = false;
    comicSlides.value = [prev, comicSlides.value[0]];
    comicOffset.value = -50;
    await nextTick();
    // 强制回流后再开启动画
    void comicTrack.value?.offsetWidth;
    comicAnimated.value = true;
    comicOffset.value = 0;
    commitFlip(false, index);
  } catch (e) {
    comicBusy.value = false;
    GLOBAL_LOG.warn('read page, comic prev failed', e);
  }
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

/** 退出对开时清掉栏样式，否则普通阅读会被强行分栏 */
const clearColumnStyle = () => {
  const el = spreadEl.value;
  if (!el) {
    return;
  }
  el.style.columnCount = '';
  el.style.columnWidth = '';
  el.style.columnGap = '';
};

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
  if (!spreadMode.value || bookType.value !== 'text') {
    clearColumnStyle();
    return;
  }
  // 用 column-count 而不是 column-width：后者只是建议值，
  // 元素宽度与视口不一致时会算出 1.x 栏，右边缘露出半截被裁的下一栏。
  el.style.columnCount = '2';
  el.style.columnWidth = '';
  el.style.columnGap = `${SPREAD_GUTTER}px`;
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
  if (!spreadMode.value || bookType.value !== 'text') {
    totalPages.value = 1;
    pageIndex.value = 0;
    spreadTransform.value = '';
    return;
  }
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

/** 换章时回到第一屏 */
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

watch([spreadMode, bookType], () => {
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

const pageLabel = computed(() => {
  if (!spreadMode.value) {
    return '';
  }
  if (bookType.value === 'comic') {
    const index = currentChapter.value?.index ?? 0;
    const from = index + 1;
    const to = Math.min(comicChapterTotal.value, index + 2);
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
      <div v-if="spreadMode && bookType === 'comic'" class="comic-viewport" :style="{ height: pageHeight }">
        <div ref="comicTrack" class="comic-track" :class="{ animated: comicAnimated }" :style="{
          transform: `translateX(${comicOffset}%)`,
          transitionDuration: `${FLIP_DURATION}ms`
        }">
          <div v-for="(slide, i) in comicSlides" :key="i" class="spread-slide" v-html="slide"></div>
        </div>
      </div>
      <div v-else id="text-content" v-show="!isRunningGetTextContent" v-html="contents" ref="spreadEl" :style="{
        width: spreadMode ? '100%' : width,
        minHeight: pageHeight,
        fontSize,
        fontWeight,
        transform: spreadMode ? spreadTransform : '',
        transition: spreadMode ? `transform ${FLIP_DURATION}ms ease` : '',
        '--rc-read-aloud-color': isDark ? '' : readAloudColor,
        '--rc-bookmark-odd-color': isDark ? '' : bookmarkColorOdd,
        '--rc-bookmark-even-color': isDark ? '' : bookmarkColorEven,
        '--rc-bookmark-odd-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorOdd : '',
        '--rc-bookmark-even-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorEven : '',
      }" :class="[spreadMode ? 'spread-text' : '', isSelectPlay && playerStatus === 'pause' ? 'play-start' : '']"></div>
    </div>
    <div v-if="spreadMode" class="spread-nav">
      <button title="上一页" @click="onPrevPage" :disabled="!canGoPrev">
        <ElIcon size="18"><IconArrowLineUp /></ElIcon>
      </button>
      <span>{{ pageLabel }}</span>
      <button title="下一页" @click="onNextPage" :disabled="!canGoNext">
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
      align-items: stretch;
      position: relative;
      /* 栏高与漫画轨道都依赖这个高度，塌陷会导致分栏失效 */
      height: v-bind(pageHeight);

      /* 中缝：让「左右两页」的边界一眼可辨，模拟纸质书摊开时的书脊 */
      &::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        transform: translateX(-0.5px);
        background: var(--rc-text-color, #1f1f1f);
        opacity: 0.12;
        pointer-events: none;
      }
    }
  }

  /* 漫画翻页轨道 */
  .comic-viewport {
    width: 100%;
    overflow: hidden;
  }

  .comic-track {
    display: flex;
    width: 200%;
    height: 100%;

    &.animated {
      transition-property: transform;
      transition-timing-function: ease;
    }
  }

  .spread-slide {
    width: 50%;
    height: 100%;
    display: flex;
    gap: 8px;
    padding: 0 8px;
    box-sizing: border-box;
    min-width: 0;
  }

  .spread-page {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    :deep(img) {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
    }

    /* 只有单页时让它居中而不是靠左 */
    &:only-child {
      flex: 0 0 100%;
    }
  }

  #text-content {
    * {
      font-family: var(--font-family);
    }

    &.spread-text {
      height: 100%;
      column-fill: auto;

      > :deep(div[data-index]) {
        break-inside: avoid;
      }

      /* 插图不得超出一页：宽度受限于栏宽，高度受限于页高，等比缩放不裁切 */
      :deep(div[data-index]) {
        img {
          max-width: 100%;
          max-height: calc(v-bind(pageHeight) - 24px);
          width: auto;
          height: auto;
          object-fit: contain;
          display: block;
          margin: 0 auto;
        }
      }

      /* 纯插图段落撑满整页并垂直居中，像纸质书的整页插图，而不是挤在顶端 */
      :deep(div[data-index]:has(> img:only-child)) {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        margin-bottom: 0;
        text-indent: 0;
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
