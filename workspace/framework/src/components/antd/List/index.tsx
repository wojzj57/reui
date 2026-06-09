/**
 * List —— 列表组件（RFC-004 §3.3 A / §5）。
 *
 * 落实 RFC 两项要求（旧实现仅有空壳）：
 *   ① 吸收旧 ListItem 的 hover 删除交互（itemDeletable / onItemDelete）；
 *   ② 大数据虚拟滚动——antd List 本身不提供虚拟滚动，故此处实现轻量窗口化
 *      渲染（按固定 itemHeight 计算可见区间 + overscan），超过 virtualThreshold
 *      条且 virtual=true 时启用，保持大列表 60fps。
 */

import React, { useRef, useState, useCallback } from 'react';

export interface ListProps<T = unknown> {
  /** 数据源 */
  items: T[];
  /** 单项渲染函数 */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 是否启用虚拟滚动 */
  virtual?: boolean;
  /** 触发虚拟滚动的阈值条数（默认 50） */
  virtualThreshold?: number;
  /** 虚拟滚动下单项高度（px，默认 40） */
  itemHeight?: number;
  /** 虚拟滚动下视口高度（px，默认 320） */
  height?: number;
  /** 虚拟滚动上下额外渲染的缓冲条数（默认 5） */
  overscan?: number;
  /** 单项是否可 hover 删除 */
  itemDeletable?: boolean;
  /** 删除回调 */
  onItemDelete?: (item: T, index: number) => void;
  /** 取 key 的函数（默认用 index） */
  rowKey?: (item: T, index: number) => React.Key;
  /** 空列表占位 */
  emptyText?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式（透传到列表容器） */
  style?: React.CSSProperties;
}

function ListRow<T>({
  item,
  index,
  renderItem,
  itemDeletable,
  onItemDelete,
  style,
}: {
  item: T;
  index: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  itemDeletable?: boolean;
  onItemDelete?: (item: T, index: number) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div className="reui-list__item" style={style}>
      <div className="reui-list__content">{renderItem(item, index)}</div>
      {itemDeletable && (
        <button
          type="button"
          className="reui-list__delete"
          aria-label="Delete"
          onClick={() => onItemDelete?.(item, index)}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function List<T = unknown>(props: ListProps<T>) {
  const {
    items,
    renderItem,
    virtual = false,
    virtualThreshold = 50,
    itemHeight = 40,
    height = 320,
    overscan = 5,
    itemDeletable = false,
    onItemDelete,
    rowKey,
    emptyText,
    className = '',
    style,
  } = props;

  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const keyOf = useCallback(
    (item: T, index: number): React.Key => (rowKey ? rowKey(item, index) : index),
    [rowKey],
  );

  const shouldVirtual = virtual && items.length > virtualThreshold;

  if (items.length === 0 && emptyText !== undefined) {
    return (
      <div className={`reui-list reui-list--empty ${className}`.trim()} role="list" style={style}>
        <div className="reui-list__empty">{emptyText}</div>
      </div>
    );
  }

  if (shouldVirtual) {
    const total = items.length;
    const visibleCount = Math.ceil(height / itemHeight);
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(total, startIndex + visibleCount + overscan * 2);
    const offsetY = startIndex * itemHeight;

    const visibleItems = items.slice(startIndex, endIndex);

    return (
      <div
        ref={containerRef}
        className={`reui-list reui-list--virtual ${className}`.trim()}
        role="list"
        style={{ height, overflowY: 'auto', ...style }}
        onScroll={handleScroll}
      >
        {/* 撑开总高度，形成正确的滚动条 */}
        <div style={{ height: total * itemHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleItems.map((item, i) => {
              const index = startIndex + i;
              return (
                <ListRow
                  key={keyOf(item, index)}
                  item={item}
                  index={index}
                  renderItem={renderItem}
                  itemDeletable={itemDeletable}
                  onItemDelete={onItemDelete}
                  style={{ height: itemHeight }}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`reui-list ${className}`.trim()} role="list" style={style}>
      {items.map((item, index) => (
        <ListRow
          key={keyOf(item, index)}
          item={item}
          index={index}
          renderItem={renderItem}
          itemDeletable={itemDeletable}
          onItemDelete={onItemDelete}
        />
      ))}
    </div>
  );
}
