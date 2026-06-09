/**
 * ProgressBar —— 进度条（RFC-004 §3.3 A / §3.4.2）。
 *
 * 吸收旧 Progress 的 number/loop 双模式；修 typo `segmengts → segments`；
 * loop 动画参数 token 化。
 *
 *   - number 模式：基于 antd Progress 渲染确定进度；
 *   - loop 模式：不确定进度——渲染自研的循环滑动动画（旧实现仅是停在 0%
 *     的圆环，无动画），动画时长取自 --reui-animation-slow token。
 */

import React from 'react';
import { Progress as AntProgress } from 'antd';

export interface ProgressBarProps {
  /** 当前值 */
  value?: number;
  /** 最大值，默认 100 */
  max?: number;
  /** 模式：number=数字百分比，loop=循环动画 */
  mode?: 'number' | 'loop';
  /** 颜色（token 名或色值） */
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 显示百分比/数值标签 */
  showLabel?: boolean;
  /** 值变化时的过渡动画（仅 number 模式生效） */
  animated?: boolean;
  /** 分段数（修旧库 typo segmengts → segments） */
  segments?: number;
  /** 自定义 label 内容 */
  children?: React.ReactNode;
  /** 无障碍标签 */
  'aria-label'?: string;
}

/** token 色名 → CSS 变量（带原值 fallback）。 */
function resolveColor(color: string): string {
  if (color.startsWith('var(') || color.startsWith('#') || color.startsWith('rgb')) {
    return color;
  }
  return `var(--reui-color-${color}, ${color})`;
}

const SIZE_HEIGHT: Record<NonNullable<ProgressBarProps['size']>, number> = {
  sm: 4,
  md: 8,
  lg: 14,
};

/**
 * 进度条组件。
 * mode: 'loop' 为无限循环动画（不确定进度）。
 */
export function ProgressBar(props: ProgressBarProps) {
  const {
    value = 0,
    max = 100,
    mode = 'number',
    color = 'accent',
    size = 'md',
    showLabel = true,
    animated = true,
    segments,
    children,
    'aria-label': ariaLabel,
  } = props;

  const stroke = resolveColor(color);
  const height = SIZE_HEIGHT[size];

  // —— loop 模式：自研不确定进度动画 ——
  if (mode === 'loop') {
    return (
      <div
        className="reui-progress reui-progress--loop"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuetext="Loading"
        style={{ height }}
      >
        <div
          className="reui-progress__loop-bar"
          style={{ background: stroke }}
        />
      </div>
    );
  }

  // —— number 模式：确定进度 ——
  const safeMax = max <= 0 ? 100 : max;
  const percent = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  const antSize = size === 'sm' ? 'small' : 'default';

  return (
    <div
      className={`reui-progress reui-progress--number${animated ? ' reui-progress--animated' : ''}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={safeMax}
    >
      <AntProgress
        percent={percent}
        showInfo={showLabel}
        size={antSize}
        strokeColor={stroke}
        steps={segments}
        format={children ? () => <>{children}</> : undefined}
      />
    </div>
  );
}
