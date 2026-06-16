/**
 * ReUI Runtime host bootstrap（RFC-009 §6.2）。
 *
 * 本文件的唯一职责是**组装**——不重新实现任何 RFC-003 服务逻辑：
 *   1. 用 getInstance() 取得共享单例（EventBus / NuiBridge / LayerSystem）；
 *   2. 构造唯一的 message 入口 MessageDispatcher 并 start() 挂上监听；
 *   3. dev 浏览器调试时把 NuiBridge 切到 mock 模式，脱离游戏环境。
 *
 * 第一阶段（RFC-009 §6 最小可验证闭环）仅串起
 *   EventBus + NuiBridge + LayerSystem + MessageDispatcher，
 * 暂不组装 PluginManager / PostMessageRouter（留待对接 RFC-002 的 validator
 * 与清单下发后）。未配置 router 时，MessageDispatcher 的 iframe 分支会静默
 * 丢弃，游戏端 reui:init / nui:* 链路不受影响。
 */

import {
  EventBus,
  NuiBridge,
  LayerSystem,
  MessageDispatcher,
} from '@reui/runtime';

const root = document.getElementById('reui-root');
if (!root) {
  throw new Error('fivem-entrance: #reui-root mount point not found in index.html');
}

// 1. 共享单例服务。
//    LayerSystem 必须在任何会惰性触发 LayerSystem.getInstance() 的依赖
//    （MessageDispatcher → PluginManager → LayerSystem）之前用显式 container
//    取得，否则会绑定到默认的 document.body。
EventBus.getInstance();
const nuiBridge = NuiBridge.getInstance();
LayerSystem.getInstance({ container: root });

// 2. 唯一 message 入口（RFC-001 §3.2）。构造后必须 start() 才会挂上
//    window 'message' 监听，游戏端 SendNUIMessage 才能被 handleGameMessage 接收。
const dispatcher = MessageDispatcher.getInstance();
dispatcher.start();

// 3. dev 浏览器调试时切 mock，sendToGame 返回 { ok, mock } 而不发 fetch。
if (import.meta.env.DEV) {
  nuiBridge.setMode('mock');
}

// 4. 之后等待 client.lua 的 reui:init 设置 resourceName，sendToGame 方可用。
