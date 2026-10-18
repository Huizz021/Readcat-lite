/**
 * 阅读页翻页动作的注册表
 *
 * 全局快捷键（src/hooks/shortcut-key.ts）负责分发按键，但「翻页」在阅读页里
 * 分两种情形：对开模式下是整屏翻动（需要阅读页的内部状态），
 * 滚动模式下只是滚动一屏。这里让阅读页把自己的翻页函数注册进来，
 * 全局快捷键优先调用它，未注册或未处理时再退回滚动。
 */

type PageTurnHandlers = {
  /** 返回 true 表示已处理（对开模式），false 则交给调用方滚动 */
  next: () => boolean
  prev: () => boolean
}

let handlers: PageTurnHandlers | null = null;

export const useReadPageTurn = () => {
  const register = (value: PageTurnHandlers) => {
    handlers = value;
  }

  const unregister = () => {
    handlers = null;
  }

  /** 尝试用阅读页自己的翻页逻辑处理，返回是否已处理 */
  const tryNext = () => {
    return handlers ? handlers.next() : false;
  }

  const tryPrev = () => {
    return handlers ? handlers.prev() : false;
  }

  return { register, unregister, tryNext, tryPrev };
}
