import { PluginDevtools } from '..';
import { PluginDevtoolsEventCode } from '../../../../events/plugin-devtools';
import { isUndefined } from '../../is';
import { Logger } from '../../logger';
import { Plugins } from '../../plugins';
import { TextToSpeechEngine } from '../../plugins/defined/ttsengine';
import { errorHandler } from '../../utils';

/** TTS transform 的中断控制器 */
let transformController: AbortController | null = null;

export const sendLog = (type: string, args: any[]) => {
  GLOBAL_IPC.send(PluginDevtoolsEventCode.ASYNC_CONSOLE_LOG, void 0, type, args.map(a => Logger.toString(a)));
}

export const runTransform = (event: PluginDevtools, code: string, texts: string[], voice: string, jscode: string) => {
  GLOBAL_LOG.debug('PluginDevtools', '执行 transform', 'texts:', texts, 'jscode:', jscode);
  if (transformController) {
    transformController.abort();
    event.send(PluginDevtoolsEventCode.PLUGIN_TTS_ENGINE_ABORT_TRANSFORM);
  }
  const controller = new AbortController;
  transformController = controller;
  event.plugin.importJSCode(jscode, {
    force: true,
    debug: true,
    enable: true,
    minify: true
  }).then(p => (<TextToSpeechEngine>p).transform(texts, {
    signal: controller.signal,
    voice
  }, async (chunk, index) => {
    event.send(PluginDevtoolsEventCode.PLUGIN_TTS_ENGINE_TRANSFORM_NEXT_CALLBACK, void 0, {
      chunk: {
        buffer: Array.from(new Uint8Array(await chunk.blob.arrayBuffer())),
        type: chunk.blob.type,
        index: chunk.index
      },
      index
    });
  }, () => {
    event.send(PluginDevtoolsEventCode.PLUGIN_TTS_ENGINE_TRANSFORM_END_CALLBACK);
  })).then(() => {
    event.send(code, void 0);
  }).catch(e => {
    event.send(code, errorHandler(e, true));
  });
}
export const runGetVoiceList = (event: PluginDevtools, code: string, jscode: string) => {
  GLOBAL_LOG.debug('PluginDevtools', '执行 getVoiceList', 'jscode:', jscode);
  event.plugin.importJSCode(jscode, {
    force: true,
    debug: true,
    enable: true,
    minify: true
  }).then(p => (<TextToSpeechEngine>p).getVoiceList()).then(res => {
    event.send(code, void 0, res);
  }).catch(e => {
    event.send(code, errorHandler(e, true));
  });
}

export const runCompile = (event: PluginDevtools, code: string, debug: boolean, jscode: string) => {
  GLOBAL_LOG.debug('PluginDevtools', '执行 compile', 'jscode:', jscode);
  const result = Plugins.UGLIFY_JS.minify(jscode, {
    compress: {
      drop_console: !debug,
      drop_debugger: !debug
    }
  });
  if (!isUndefined(result.error)) {
    event.send(code, errorHandler(result.error, true));
  } else {
    event.send(code, void 0, debug, result.code);
  }
}