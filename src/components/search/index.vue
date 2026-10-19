<script setup lang="ts">
import { Window, WindowEvent, WindowSize, Text } from '..';
import IconPrevChapter from '../../assets/svg/icon-prev-chapter.svg';
import IconNextChapter from '../../assets/svg/icon-next-chapter.svg';
import { PagePath } from '../../core/window';
import { storeToRefs } from 'pinia';
import { useWindowStore } from '../../store/window';
import ChapterBox from './components/chapter-box/index.vue';
import { computed, reactive, ref } from 'vue';
import { useHeaderStyle } from '../../hooks/header-style';
import { useSettingsStore } from '../../store/settings';
import { useTextContentStore } from '../../store/text-content';

const win = useWindowStore();
const { currentPath, searchBoxHeaderText, transparentWindow } = storeToRefs(win);

const { searchStyle } = useHeaderStyle();

const winEvent = ref<WindowEvent>();
const winSize = reactive<WindowSize>({
  width: '40rem',
  height: '50rem'
});

const { backgroundImage } = storeToRefs(useSettingsStore());
const isReadPage = computed(() => currentPath.value === PagePath.READ);
const { options } = useSettingsStore();
const { prevChapter, nextChapter } = useTextContentStore();
const toggleChapter = (e: MouseEvent, type: 'prev' | 'next') => {
  e.stopPropagation();
  if (type === 'prev') {
    prevChapter();
  } else if (type === 'next') {
    nextChapter();
  }
}
</script>
<script lang="ts">
export default {
  name: 'Search'
}
</script>
<template>
  <div class="container" :style="{
    '--rc-search-border-color': searchStyle.borderColor,
    '--rc-search-bgcolor': searchStyle.backgroundColor,
    '--rc-theme-color': searchStyle.color,
    '--rc-search-box-bgcolor': searchStyle.boxBackgroundColor,
  }">
    <div id="search">
      <button v-if="isReadPage && options.enableShowToggleChapterButton" class="prev-chapter" title="上一章" @click="e => toggleChapter(e, 'prev')">
        <IconPrevChapter />
      </button>
      <div class="title">
        <Text ellipsis v-memo="[searchBoxHeaderText]">{{ searchBoxHeaderText }}</Text>
      </div>
      <button v-if="isReadPage && options.enableShowToggleChapterButton" class="next-chapter" title="下一章" @click="e => toggleChapter(e, 'next')">
        <IconNextChapter />
      </button>
    </div>
    <Window
      :to-body="!!backgroundImage || transparentWindow"
      destroy-on-close :top="5"
      center-x
      :width="winSize.width"
      :height="winSize.height"
      :background-color="backgroundImage ? '' : 'var(--rc-search-box-bgcolor)'"
      @event="e => winEvent = e"
    >
      <ChapterBox :window-event="winEvent" />
    </Window>
  </div>
</template>

<style scoped lang="scss">
.container {
  position: relative;
  width: 100%;
  #search {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 .5rem;
    width: calc(100% - 1.2rem);
    height: 2.4rem;
    color: var(--rc-theme-color);
    font-size: 1.2rem;
    cursor: pointer;

    .title {
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: calc(100% - 2.5rem * 2);
      span {
        max-width: 23rem;
      }
    }
    button.prev-chapter,
    button.next-chapter {
      display: flex;
      justify-content: center;
      align-items: center;
      flex: none;
      color: currentColor;
      transition: all .3s ease;
      svg {
        width: 1.8rem;
        height: 1.8rem;
      }
      &:hover {
        transform: scale(1.1);
        cursor: pointer;
      }
      &:active {
        transform: scale(0.9);
      }
    }
  }
}
</style>
