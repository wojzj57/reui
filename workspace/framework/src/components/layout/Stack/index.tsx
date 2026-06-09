/**
 * Stack —— Flex 布局辅助（RFC-004 §3.3 B）。
 *
 * 吸收旧 Item 行/卡片排布。
 * direction, gap, align, justify。
 */

import React from 'react';
import type { ReactNode, CSSProperties } from 'react';

export type StackDirection = 'horizontal' | 'vertical';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface StackProps {
  /** 排列方向 */
  direction?: StackDirection;
  /** 间隙 */
  gap?: string | number;
  /** 交叉轴对齐 */
  align?: StackAlign;
  /** 主轴对齐 */
  justify?: StackJustify;
  /** 是否自动换行 */
  wrap?: boolean;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 自定义类名 */
  className?: string;
  /** 子内容 */
  children: ReactNode;
}

const ALIGN_MAP: Record<StackAlign, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const JUSTIFY_MAP: Record<StackJustify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * Flex 布局辅助组件。
 *
 * @example
 * <Stack direction="horizontal" gap="md" align="center">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Stack>
 */
export function Stack(props: StackProps) {
  const {
    direction = 'vertical',
    gap = 'md',
    align = 'stretch',
    justify = 'start',
    wrap = false,
    style,
    className = '',
    children,
  } = props;

  const gapValue = typeof gap === 'number' ? `${gap}px` : `var(--reui-spacing-${gap}, ${gap})`;

  const stackStyle: CSSProperties = {
    display: 'flex',
    flexDirection: direction === 'horizontal' ? 'row' : 'column',
    gap: gapValue,
    alignItems: ALIGN_MAP[align],
    justifyContent: JUSTIFY_MAP[justify],
    flexWrap: wrap ? 'wrap' : 'nowrap',
    ...style,
  };

  return (
    <div className={`reui-stack ${className}`.trim()} style={stackStyle}>
      {children}
    </div>
  );
}
