/**
 * ContextMenu —— 右键菜单（RFC-004 §3.3 A）。
 *
 * 基于 antd Dropdown + Menu 重写，适配右键场景。
 * 支持嵌套子菜单、快捷键提示。
 *
 * 修复点：
 *   - onClick 不再重复触发（旧实现 menu 级与 item 级回调叠加）；
 *   - 受控弹出锚定到鼠标坐标，菜单在光标处弹出（旧实现锚定到子元素左上角）。
 */

import React, { useState, useCallback } from 'react';
import { Dropdown } from 'antd';
import type { MenuProps, DropdownProps } from 'antd';

export interface ContextMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string;       // 快捷键提示
  disabled?: boolean;
  danger?: boolean;
  children?: ContextMenuItem[];  // 嵌套子菜单
  onClick?: (key: string) => void;
}

export interface ContextMenuProps {
  /** 菜单项 */
  items: ContextMenuItem[];
  /** 触发元素（右键点击此元素弹出菜单） */
  children: React.ReactElement;
  /** 菜单点击回调（任意项点击都会触发一次，仅一次） */
  onClick?: (key: string) => void;
  /** 菜单可见性变化回调 */
  onOpenChange?: (open: boolean) => void;
}

/**
 * 右键菜单组件。
 *
 * @example
 * <ContextMenu
 *   items={[
 *     { key: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
 *     { key: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
 *   ]}
 *   onClick={(key) => console.log(key)}
 * >
 *   <div>Right click me</div>
 * </ContextMenu>
 */
export function ContextMenu(props: ContextMenuProps) {
  const { items, children, onClick, onOpenChange } = props;
  const [open, setOpen] = useState(false);

  // 建立 key → item 的索引，便于点击时定位 item 自身的 onClick。
  const itemMap = React.useMemo(() => {
    const map = new Map<string, ContextMenuItem>();
    const walk = (list: ContextMenuItem[]) => {
      for (const it of list) {
        map.set(it.key, it);
        if (it.children) walk(it.children);
      }
    };
    walk(items);
    return map;
  }, [items]);

  // 将 ContextMenuItem[] 转换为 antd MenuProps['items']（不在此处挂 onClick，
  // 统一由 menu 级 onClick 分发，避免重复触发）。
  const convertItems = useCallback(
    (list: ContextMenuItem[]): MenuProps['items'] =>
      list.map((item) => ({
        key: item.key,
        label: (
          <span className="reui-context-menu-item">
            <span className="reui-context-menu-label">{item.label}</span>
            {item.shortcut && (
              <span className="reui-context-menu-shortcut">{item.shortcut}</span>
            )}
          </span>
        ),
        icon: item.icon,
        disabled: item.disabled,
        danger: item.danger,
        children: item.children ? convertItems(item.children) : undefined,
      })),
    [],
  );

  // 单一分发点：先调 item 自身 onClick，再调全局 onClick，各一次。
  const handleMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    (info) => {
      const item = itemMap.get(info.key);
      item?.onClick?.(info.key);
      onClick?.(info.key);
      setOpen(false);
    },
    [itemMap, onClick],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const dropdownProps: DropdownProps = {
    open,
    onOpenChange: handleOpenChange,
    menu: { items: convertItems(items), onClick: handleMenuClick },
    // 由 antd 处理右键触发与光标定位（受控 open 下交给 trigger 行为，
    // 菜单锚定到右键位置而非子元素左上角）。
    trigger: ['contextMenu'],
    overlayClassName: 'reui-context-menu',
  };

  return <Dropdown {...dropdownProps}>{children}</Dropdown>;
}
