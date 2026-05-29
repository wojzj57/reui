/**
 * 运行时权限匹配（RFC-002 §4.3）。
 *
 * 提供 hasPermission / canAccessPlugin 两个纯函数，供 PostMessageRouter
 * 在每次 API 调用时强制执行。这是"配置层若被绕过依然能拦截"的最后防线。
 */

/** 通配符与 runtime.all 的一站式匹配（§4.3.2）。 */
export function hasPermission(granted: readonly string[], required: string): boolean {
  if (!required) return true;
  if (granted.includes(required)) return true;
  if (granted.includes('runtime.all') && required.startsWith('runtime.')) return true;

  // 通配符 runtime.* / plugins.* / nested.* 等：
  // 取 required 的所有前缀拼上 ".*"，逐级回退匹配。
  const parts = required.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = parts.slice(0, i).join('.') + '.*';
    if (granted.includes(wildcard)) return true;
  }
  return false;
}

/** 跨插件访问检查（§4.3.2）。 */
export function canAccessPlugin(
  granted: readonly string[],
  targetPluginId: string,
): boolean {
  if (granted.includes('plugins.all')) return true;
  return granted.includes(`plugins.${targetPluginId}`);
}

/**
 * RFC-002 §4.3.1 「Method → Permission 映射」。
 * 暴露为常量便于上层 router 共享与测试。
 */
export const METHOD_PERMISSIONS: Readonly<Record<string, string | null>> = Object.freeze({
  'http:request': 'runtime.network',
  'ws:send': 'runtime.websocket',
  'ws:state': 'runtime.websocket',
  'event:subscribe': 'runtime.message',
  'event:unsubscribe': 'runtime.message',
  'event:emit': 'runtime.message',
  'nui:send': 'runtime.message',
  // 控制自身的方法不需要权限
  'plugin:show': null,
  'plugin:hide': null,
  'plugin:ready': null,
  'plugin:getConfig': null,
  'plugin:saveState': null,
  'plugin:restoreState': null,
});

/**
 * 查询 method 所需的权限（未注册的 method 返回 undefined，由 router 决定是否拒绝）。
 */
export function requiredPermissionFor(method: string): string | null | undefined {
  return METHOD_PERMISSIONS[method];
}
