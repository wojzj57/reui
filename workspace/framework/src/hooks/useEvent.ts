/**
 * useEvent —— 订阅 EventBus 事件（插件间通讯）（RFC-004 §3.5）。
 *
 * 底层 core event.on()。
 */

import { useEffect, useRef } from 'react';
import { event } from '@reui/core';

export function useEvent(
  eventName: string,
  handler: (data: unknown) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = event.on(eventName, (data: unknown) => {
      handlerRef.current(data);
    });
    return unsub;
  }, [eventName]);
}
