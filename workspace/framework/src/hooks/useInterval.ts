/**
 * useInterval —— 封装 setInterval（吸收自旧库 Common/Utilis/Interval）。
 *
 * 组件卸载时自动清理定时器。
 * 延迟（ms）为 0 或负值时不启动定时器。
 */

import { useEffect, useRef } from 'react';

export function useInterval(callback: () => void, ms: number): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ms || ms <= 0) return undefined;

    const id = setInterval(() => {
      callbackRef.current();
    }, ms);

    return () => clearInterval(id);
  }, [ms]);
}
