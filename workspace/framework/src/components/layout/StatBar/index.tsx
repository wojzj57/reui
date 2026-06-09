/**
 * StatBar —— 状态条组（RFC-004 §3.3 B）。
 *
 * 多个横向指标条（血量/饥饿/口渴），底层复用 ProgressBar。
 */

import React from 'react';
import type { ReactNode } from 'react';
import { ProgressBar } from '../../antd/ProgressBar';

export interface StatItem {
  /** 唯一标识 */
  key: string;
  /** 当前值 */
  value: number;
  /** 最大值 */
  max?: number;
  /** 标签 */
  label?: ReactNode;
  /** 颜色 */
  color?: 'accent' | 'success' | 'warning' | 'danger' | string;
  /** 是否显示标签 */
  showLabel?: boolean;
}

export interface StatBarProps {
  /** 状态条数据 */
  items: StatItem[];
  /** 布局方向 */
  direction?: 'horizontal' | 'vertical';
  /** 条状尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 自定义类名 */
  className?: string;
}

/**
 * 状态条组组件。
 * 底层复用 ProgressBar，支持多个横向指标条。
 *
 * @example
 * <StatBar
 *   items={[
 *     { key: 'health', label: 'HP', value: 75, color: 'success' },
 *     { key: 'hunger', label: 'Hunger', value: 50, color: 'warning' },
 *   ]}
 * />
 */
export function StatBar(props: StatBarProps) {
  const {
    items,
    direction = 'vertical',
    size = 'md',
    className = '',
  } = props;

  return (
    <div
      className={`reui-stat-bar reui-stat-bar--${direction} ${className}`.trim()}
      role="group"
      aria-label="Status bars"
    >
      {items.map((item) => (
        <div key={item.key} className="reui-stat-bar__item">
          {(item.label || item.showLabel) && (
            <div className="reui-stat-bar__label">
              {item.label && <span>{item.label}</span>}
              {item.showLabel && (
                <span className="reui-stat-bar__value">
                  {item.value}/{item.max ?? 100}
                </span>
              )}
            </div>
          )}
          <ProgressBar
            value={item.value}
            max={item.max ?? 100}
            color={item.color}
            size={size}
            showLabel={false}
            aria-label={`${item.key}: ${item.value}/${item.max ?? 100}`}
          />
        </div>
      ))}
    </div>
  );
}
