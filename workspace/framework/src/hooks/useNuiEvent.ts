/**
 * useNuiEvent —— 命令式订阅 NUI 游戏事件（RFC-004 §3.5）。
 *
 * 适用于触发副作用（播放音效、写日志等）。
 * 内部通过 @reui/core 的 nui.onGameEvent() 注册监听，
 * useEffect cleanup 调用返回的 Unsubscribe。
 * 使用 useRef 存储最新 handler 引用，避免闭包过时问题。
 */

import { useEffect, useRef } from 'react';
import { nui } from '@reui/core';

export function useNuiEvent(
  eventName: string,
  handler: (data: unknown) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = nui.onGameEvent(eventName, (data: unknown) => {
      handlerRef.current(data);
    });
    return unsub;
  }, [eventName]);
}
