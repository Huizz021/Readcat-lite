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
import { useReadPageTurn } from '../../hooks/read-page-turn';
import { useReadSearch, SearchHit } from './hooks/search';
import IconSearch from '../../assets/svg/icon-search.svg';

const route = useRoute();

const pid = String(route.query.pid);
const detailUrl = String(route.query.detailUrl);

const textContentStore = useTextContentStore();
const { currentChapter } = storeToRefs(textContentStore);
const { gotoChapter } = textContentStore;
const { detailResult } = storeToRefs(useDetailStore());
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
  getTextContent(pid, currentChapter.value).then(() => {
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

/** 栏间距基准（会按页宽再调整） */
const SPREAD_GUTTER = 40;

/**
 * 中缝留白。
 *
 * 实体书的「内白边」（两页相对的一侧）通常是最宽的一条，
 * 比外白边还要宽一些。这里按页宽的 12% 计算，并限定在 64~140px，
 * 保证窄窗口下不会把正文挤成细条。
 */
const gutterFor = (pageWidth: number) => {
  if (pageWidth <= 0) {
    return SPREAD_GUTTER;
  }
  return Math.round(Math.min(140, Math.max(64, pageWidth * 0.12)));
};
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
/** 是否启用位移过渡：跨章定位时需要先瞬时归位再滑入，否则会整屏倒滑 */
const spreadAnimating = ref(true);

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

const onNextPage = async () => {
  if (!spreadMode.value) {
    return;
  }
  if (bookType.value !== 'comic') {
    // 已经是本章最后一屏 → 进入下一章，并让新内容从右侧翻进来
    if (pageIndex.value >= totalPages.value - 1) {
      try {
        await nextChapter(true);
        await nextTick();
        recalcPages();
        pageIndex.value = 0;
        const step = pageStep();
        await slideTo(step, 0);
      } catch (e) {
        GLOBAL_LOG.warn('read page, next chapter failed', e);
      }
      return;
    }
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
    // 已经是本章第一屏 → 回到上一章，并让它的最后一屏从左侧翻进来
    if (pageIndex.value <= 0) {
      try {
        await prevChapter(true);
        await nextTick();
        recalcPages();
        // 排版（尤其图片）可能还没稳定，稍等再定位
        await new Promise(r => setTimeout(r, 180));
        recalcPages();
        const step = pageStep();
        const last = Math.max(0, totalPages.value - 1);
        pageIndex.value = last;
        await slideTo(-(last + 1) * step, -last * step);
      } catch (e) {
        GLOBAL_LOG.warn('read page, prev chapter failed', e);
      }
      return;
    }
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
  if (pageIndex.value < totalPages.value - 1) {
    return true;
  }
  // 本章最后一屏：还有下一章就允许翻（会自动跨章）
  const index = currentChapter.value?.index;
  return !isUndefined(index) && index + 1 < comicChapterTotal.value;
});

const canGoPrev = computed(() => {
  if (bookType.value === 'comic') {
    const index = currentChapter.value?.index;
    return !isUndefined(index) && index - 1 >= 0;
  }
  if (pageIndex.value > 0) {
    return true;
  }
  const index = currentChapter.value?.index;
  return !isUndefined(index) && index - 1 >= 0;
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
  if (!el) {
    return;
  }
  if (el.clientWidth <= 0) {
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
  el.style.columnGap = `${gutterFor(el.clientWidth)}px`;
};

/**
 * 一页的步长。
 *
 * column-count: 2 时，两栏 + 一个栏间距正好填满元素宽度；
 * 但页与页之间还有第二个栏间距，所以步长是「元素宽 + 栏间距」。
 * 直接用元素宽会让每页少移一个间距，下一页的内容从右边漏进来。
 */
const pageStep = () => {
  const el = spreadEl.value;
  if (!el || el.clientWidth <= 0) {
    return 0;
  }
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  return el.clientWidth + gap;
};

/** 根据内容总宽度重算页数，并修正当前页码 */
const recalcPages = () => {
  const el = spreadEl.value;
  if (!el) {
    return;
  }
  if (el.clientWidth <= 0) {
    return;
  }
  applyColumnWidth();
  if (!spreadMode.value || bookType.value !== 'text') {
    totalPages.value = 1;
    pageIndex.value = 0;
    spreadTransform.value = '';
    return;
  }
  const step = pageStep();
  if (step <= 0) {
    return;
  }
  totalPages.value = Math.max(1, Math.ceil(el.scrollWidth / step));
  pageIndex.value = Math.min(Math.max(0, pageIndex.value), totalPages.value - 1);
  updateTransform();
};

const updateTransform = () => {
  const step = pageStep();
  if (step <= 0) {
    return;
  }
  spreadTransform.value = `translateX(${-pageIndex.value * step}px)`;
};

/**
 * 从指定位置滑到目标位置。
 *
 * 跨章时如果直接改 pageIndex，会从「本章第 N 屏」整屏倒滑回第 1 屏，
 * 观感非常割裂。这里先把内容瞬时放到目标页的相邻位置（无过渡），
 * 再开启过渡滑到目标页——视觉上就是「新的一页从右边/左边翻进来」。
 */
const slideTo = async (fromPx: number, toPx: number) => {
  const el = spreadEl.value;
  if (!el) {
    spreadTransform.value = `translateX(${toPx}px)`;
    return;
  }
  spreadAnimating.value = false;
  spreadTransform.value = `translateX(${fromPx}px)`;
  await nextTick();
  void el.offsetWidth;
  spreadAnimating.value = true;
  await nextTick();
  void el.offsetWidth;
  spreadTransform.value = `translateX(${toPx}px)`;
};

/** 跨章翻页时，等新章节排版完成后再落到指定的页 */


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

/** 滚轮翻页（仅对开模式；滚动模式下滚轮仍是正常滚动） */
let wheelLocked = false;
const onWheel = (e: WheelEvent) => {
  if (!spreadMode.value) {
    return;
  }
  e.preventDefault();
  if (wheelLocked || Math.abs(e.deltaY) < 4) {
    return;
  }
  wheelLocked = true;
  window.setTimeout(() => { wheelLocked = false; }, FLIP_DURATION + 120);
  if (e.deltaY > 0) {
    onNextPage();
  } else {
    onPrevPage();
  }
};

/** 注册到全局快捷键：对开模式下接管翻页，未处理时由全局退回滚动 */
const { register: registerPageTurn, unregister: unregisterPageTurn } = useReadPageTurn();

/* ---------------- 全文搜索 ---------------- */

const {
  keyword: searchKeyword,
  hits: searchHits,
  searching,
  searched,
  truncated,
  run: runSearch,
  reset: resetSearch,
} = useReadSearch();
const searchVisible = ref(false);
const searchInput = ref<HTMLInputElement>();
const chapterList = computed(() => detailResult.value?.chapterList || []);

const openSearch = () => {
  searchVisible.value = true;
  nextTick(() => searchInput.value?.focus());
};

const closeSearch = () => {
  searchVisible.value = false;
  resetSearch();
};

let searchTimer: number | undefined;
const onSearchInput = () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    runSearch(pid, chapterList.value, searchKeyword.value);
  }, 250);
};

/** 定位到命中的段落：对开模式跳到它所在的那一屏，滚动模式滚到中间，并闪一下 */
const flashParagraph = (paragraphIndex: number) => {
  const node = document.querySelector<HTMLElement>(`#text-content > div[data-index="${paragraphIndex}"]`);
  if (!node) {
    return;
  }
  if (spreadMode.value) {
    const step = pageStep();
    if (step > 0) {
      const page = Math.floor(node.offsetLeft / step);
      pageIndex.value = Math.max(0, Math.min(totalPages.value - 1, page));
      updateTransform();
    }
  } else {
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  node.classList.add('search-hit-flash');
  window.setTimeout(() => node.classList.remove('search-hit-flash'), 2000);
};

const onHitClick = async (hit: SearchHit) => {
  searchVisible.value = false;
  await gotoChapter(hit.chapterIndex, true);
  await nextTick();
  // 新章节的排版（尤其图片）可能还没稳定，稍等再定位
  window.setTimeout(() => {
    recalcPages();
    flashParagraph(hit.paragraphIndex);
  }, 220);
};

/** Ctrl+F / Cmd+F 打开搜索 */
const onSearchKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === 'Escape' && searchVisible.value) {
    closeSearch();
  }
};
const handleShortcutNext = () => {
  if (!spreadMode.value) {
    return false;
  }
  onNextPage();
  return true;
};
const handleShortcutPrev = () => {
  if (!spreadMode.value) {
    return false;
  }
  onPrevPage();
  return true;
};

onMounted(() => {
  registerPageTurn({ next: handleShortcutNext, prev: handleShortcutPrev });
  window.addEventListener('resize', onResize);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onSearchKeydown);

  // 点击章节会直接跳到阅读页，此时 currentChapter 与 contents 在挂载前就已就绪，
  // watch 不会触发，必须在挂载后主动算一次。延迟一次以避开布局未完成的时序。
  nextTick(() => {
    recalcPages();
    setTimeout(recalcPages, 200);
  });
});

onUnmounted(() => {
  unregisterPageTurn();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onSearchKeydown);
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
      <div v-if="spreadMode && bookType === 'comic'" class="comic-viewport" style="height: 100%">
        <div ref="comicTrack" class="comic-track" :class="{ animated: comicAnimated }" :style="{
          transform: `translateX(${comicOffset}%)`,
          transitionDuration: `${FLIP_DURATION}ms`
        }">
          <div v-for="(slide, i) in comicSlides" :key="i" class="spread-slide" v-html="slide"></div>
        </div>
      </div>
      <div v-else class="text-viewport" :class="{ spread: spreadMode }">
        <div id="text-content" v-show="!isRunningGetTextContent" v-html="contents" ref="spreadEl" :style="{
          width: spreadMode ? '100%' : width,
          minHeight: spreadMode ? '' : pageHeight,
          fontSize,
          fontWeight,
          transform: spreadMode ? spreadTransform : '',
          transition: spreadMode && spreadAnimating ? `transform ${FLIP_DURATION}ms ease` : '',
          '--rc-read-aloud-color': isDark ? '' : readAloudColor,
          '--rc-bookmark-odd-color': isDark ? '' : bookmarkColorOdd,
          '--rc-bookmark-even-color': isDark ? '' : bookmarkColorEven,
          '--rc-bookmark-odd-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorOdd : '',
          '--rc-bookmark-even-font-color': isDark ? options.enableBookmarkHighlight ? '' : 'none' : options.enableBookmarkHighlight ? bookmarkColorEven : '',
        }" :class="[spreadMode ? 'spread-text' : '', isSelectPlay && playerStatus === 'pause' ? 'play-start' : '']"></div>
      </div>
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

    <!-- 全文搜索 -->
    <button class="reader-search-trigger" title="全文搜索 (Ctrl+F)" @click="openSearch">
      <ElIcon size="16"><IconSearch /></ElIcon>
    </button>
    <div v-if="searchVisible" class="reader-search-panel" @click.stop @wheel.stop>
      <div class="reader-search-head">
        <input ref="searchInput" v-model="searchKeyword" placeholder="搜索本书内容" @input="onSearchInput" />
        <button class="reader-search-close" @click="closeSearch">关闭</button>
      </div>
      <div class="reader-search-body">
        <p v-if="searching" class="reader-search-tip">搜索中…</p>
        <p v-else-if="!searched" class="reader-search-tip">输入关键词开始搜索</p>
        <p v-else-if="searchHits.length === 0" class="reader-search-tip">没有找到「{{ searchKeyword }}」</p>
        <template v-else>
          <p v-if="truncated" class="reader-search-tip">结果过多，仅显示前 {{ searchHits.length }} 条</p>
          <div v-for="(hit, i) in searchHits" :key="i" class="reader-search-hit" @click="onHitClick(hit)">
            <div class="reader-search-chapter">{{ hit.chapterTitle }}</div>
            <div class="reader-search-snippet" v-html="hit.snippet"></div>
          </div>
        </template>
      </div>
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
      /* 页边距：实体书不会让文字贴到纸边，左右留白比上下略大 */
      padding: 12px 5%;
      box-sizing: border-box;

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

  /* 正文视口：滚动模式下用于居中 80% 宽度的正文 */
  .text-viewport {
    width: 100%;
    display: flex;
    justify-content: center;

    /* 对开模式下裁剪边界必须等于页宽（内容盒）。
       多栏内容会溢出到元素框之外，若只在舞台（含 padding）上裁剪，
       溢出部分会落在左右页边距里露出来——就是右边缘那条竖排文字。 */
    &.spread {
      display: block;
      height: 100%;
      overflow: hidden;
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
          /* 扣掉舞台的上下 padding，避免超出可视页高被裁 */
          max-height: calc(v-bind(pageHeight) - 48px);
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

  /* ---------------- 全文搜索 ---------------- */

  .reader-search-trigger {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.18));
    border-radius: 8px;
    background: transparent;
    color: var(--rc-text-secondary, #5F5E5A);
    cursor: pointer;
    opacity: 0.45;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }

  .reader-search-panel {
    position: absolute;
    top: 48px;
    right: 10px;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: 360px;
    max-width: calc(100% - 20px);
    max-height: 60vh;
    border: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.18));
    border-radius: 10px;
    background: var(--rc-bg, #fff);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    overflow: hidden;
  }

  .reader-search-head {
    display: flex;
    gap: 8px;
    padding: 10px;
    border-bottom: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.12));

    input {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 10px;
      border: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.2));
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font-size: 13px;
      outline: none;
    }

    .reader-search-close {
      flex: none;
      padding: 0 10px;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--rc-text-secondary, #5F5E5A);
      font-size: 12px;
      cursor: pointer;
    }
  }

  .reader-search-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .reader-search-tip {
    margin: 0;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--rc-text-secondary, #8a8a85);
  }

  .reader-search-hit {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 0.5px solid var(--color-border-secondary, rgba(0, 0, 0, 0.06));

    &:hover {
      background: var(--color-fill-light, rgba(0, 0, 0, 0.04));
    }
  }

  .reader-search-chapter {
    margin-bottom: 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--rc-text-color, #1f1f1f);
    opacity: 0.85;
  }

  .reader-search-snippet {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--rc-text-secondary, #5F5E5A);
    word-break: break-all;

    :deep(mark) {
      padding: 0 1px;
      border-radius: 2px;
      background: #ffd666;
      color: #1f1f1f;
    }
  }

  /* 命中段落的短暂高亮 */
  :deep(.search-hit-flash) {
    animation: search-hit-flash 1.8s ease;
  }

  @keyframes search-hit-flash {
    0%, 60% {
      background: rgba(255, 214, 102, 0.45);
    }
    100% {
      background: transparent;
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
