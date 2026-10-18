import { useSettingsStore } from '../../../store/settings';
import { SettingsEntity } from '../database';
import { BaseStoreDatabase } from './base-store';
import { debounce } from '../../utils/timer';
import { useMessage } from '../../../hooks/message';
import { Settings } from '../../../store/defined/settings';
import { isNull, isUndefined } from '../../is';
import fsp from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Core } from '../..';

export class SettingsStoreDatabase extends BaseStoreDatabase<SettingsEntity> {
  constructor(db: IDBDatabase, storeName: string) {
    super(db, storeName, 'SettingsStoreDatabase');
  }

  public async read() {
    const all = await super.getAll();
    if (isNull(all) || all.length <= 0) {
      return;
    }
    const use = all.find(v => v.use);
    if (isUndefined(use)) {
      return;
    }
    
    const settings = useSettingsStore();
    settings.$patch({
      ...use.settings,
      debug: Core.isDev
    });
    settings.setTheme(use.settings.theme);

    // 快捷键默认值迁移：旧默认是「←/→ 切章节、PageUp/PageDown 翻页」，反直觉。
    // 新默认改为「←/→ 翻页、Alt+←/→ 切章节」。只在用户完全没改过时迁移，
    // 自定义过的配置一律不动。
    // 注意：这一步发生在 watch() 订阅之前，不会自动触发保存，必须显式写回。
    try {
      const sk = settings.shortcutKey;
      if (sk && sk.nextPage === 'PageDown' && sk.prevPage === 'PageUp'
        && sk.nextChapter === '→' && sk.prevChapter === '←') {
        sk.nextPage = '→';
        sk.prevPage = '←';
        sk.nextChapter = 'Alt+→';
        sk.prevChapter = 'Alt+←';
        await super.put({
          use: true,
          id: use.id,
          settings: {
            ...use.settings,
            shortcutKey: { ...use.settings.shortcutKey, ...sk }
          }
        });
        GLOBAL_LOG.debug('settings', 'shortcut key migrated to new defaults');
      }
    } catch (e) {
      GLOBAL_LOG.warn('settings', 'shortcut key migration failed', e);
    }

    if (!Core.userDataPath) {
      GLOBAL_LOG.error('window_transparent, userDataPath is undefined');
      return;
    }
    const filename = path.join(Core.userDataPath, 'window_transparent');
    if (use.settings.options.enableTransparentWindow) {
      !existsSync(filename) && fsp.writeFile(filename, '');
    } else {
      existsSync(filename) && fsp.unlink(filename);
    }
  }
  public watch() {
    const message = useMessage();
    const debo = debounce((state: Settings) => {
      super.put({
        use: true,
        id: state.id,
        settings: state
      }).catch(e => {
        GLOBAL_LOG.error(this.tag, 'watch', e);
        message.error(`设置保存失败, ${e.message}`);
      });
    }, 5 * 1000);
    useSettingsStore().$subscribe((_, state) => {
      debo(super.revocationProxy(state));
    }, {
      deep: true
    });
  }
}