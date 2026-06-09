/**
 * Slider —— antd Slider 封装层（RFC-004 §3.3 A / §3.4.3）。
 *
 * 吸收旧库双色范围条可视化（亮点）。
 * 硬编码颜色改走 token（通过 CSS 变量）。
 */

import React, { useMemo } from 'react';
import { Slider as AntSlider } from 'antd';

export interface SliderProps {
  /** 吸收旧库「以中点为界双色」可视化 */
  centered?: boolean;
  /** 自定义颜色（token 名或色值） */
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  /** 变化回调 */
  onChange?: (value: number | [number, number]) => void;
  /** 当前值 */
  value?: number | [number, number];
  /** 默认值 */
  defaultValue?: number | [number, number];
  /** 最小值 */
  min?: number;
  /** 最大值 */
  max?: number;
  /** 步长 */
  step?: number;
  /** 双滑块区间 */
  range?: boolean;
  /** 刻度标记 */
  marks?: Record<number, React.ReactNode>;
  /** 是否禁用 */
  disabled?: boolean;
  /** 其他透传给 antd Slider 的属性 */
  [key: string]: unknown;
}

/**
 * 基于 antd Slider 的封装组件。
 * centered 模式下，轨道以 (min+max)/2 为界，两侧异色。
 *
 * @example
 * <Slider min={0} max={100} centered />
 * <Slider range defaultValue={[20, 50]} />
 */
export function Slider(props: SliderProps) {
  const {
    centered = false,
    color = 'accent',
    onChange,
    ...rest
  } = props;

  // centered 模式：通过 CSS 变量注入双色
  const sliderStyle = useMemo(() => {
    if (!centered) return undefined;
    // color prop 控制高位颜色，低位默认用 warning
    const highColor = color === 'accent' ? 'var(--reui-color-accent)' :
                      color === 'success' ? 'var(--reui-color-success)' :
                      color === 'danger' ? 'var(--reui-color-danger)' :
                      color === 'warning' ? 'var(--reui-color-warning)' :
                      color;
    const lowColor = 'var(--reui-color-warning)';
    return {
      '--reui-slider-color-low': lowColor,
      '--reui-slider-color-high': highColor,
    } as React.CSSProperties;
  }, [centered, color]);

  return (
    <div className={centered ? 'reui-slider-centered' : undefined} style={sliderStyle}>
      <AntSlider
        {...(rest as Record<string, unknown>)}
        onChange={onChange as any}
      />
    </div>
  );
}
