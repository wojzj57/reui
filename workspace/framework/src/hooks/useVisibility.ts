/**
 * useVisibility —— 监听当前插件的可见性状态（RFC-004 §3.5）。
 *
 * Runtime 隐藏/显示 iframe 时自动更新。
 * 可用于暂停渲染、停止轮询等优化。
 * 底层 core plugin.onVisibilityChange()。
 */

import { useState, useEffect } from 'react';
import { plugin } from '@reui/core';

export function useVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // plugin 模块没有 getVisibility() API，默认可见
    // 监听可见性变化
    const unsub = plugin.onVisibilityChange((v: boolean) => {
      setVisible(v);
    });

    return unsub;
  }, []);

  return visible;
}
