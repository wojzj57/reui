/**
 * Panel —— 面板容器（RFC-004 §3.4.1 / §3.3 B）。
 *
 * 吸收旧 Content 的 onInit/加载态与 Glass 的玻璃拟物效果（参数化）。
 * 支持拖拽（pointer events + transform GPU 加速）、缩放、关闭。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

export interface PanelProps {
  /** 标题 */
  title?: string;
  /** 标题栏图标 */
  icon?: ReactNode;
  /** 是否可关闭 */
  closable?: boolean;
  /** 是否可拖拽 */
  draggable?: boolean;
  /** 是否可缩放 */
  resizable?: boolean;
  /** 玻璃拟物效果（吸收旧 Glass，参数化） */
  glass?: boolean;
  /** 玻璃模糊半径（glass=true 时生效） */
  glassBlur?: number;
  /** 玻璃透明度（glass=true 时生效） */
  glassOpacity?: number;
  /** 宽度 */
  width?: string | number;
  /** 高度 */
  height?: string | number;
  /** 最小宽度 */
  minWidth?: number;
  /** 最小高度 */
  minHeight?: number;
  /** 默认位置 */
  defaultPosition?: { x: number; y: number };
  /** 关闭回调 */
  onClose?: () => void;
  /** 缩放回调 */
  onResize?: (width: number, height: number) => void;
  /** 自定义类名 */
  className?: string;
  /** 子内容 */
  children: ReactNode;
}

/**
 * 面板容器组件。
 *
 * @example
 * <Panel title="背包" closable draggable>
 *   <div>Content</div>
 * </Panel>
 *
 * <Panel title="Glass Panel" glass glassBlur={16}>
 *   <div>Glassmorphism</div>
 * </Panel>
 */
export function Panel(props: PanelProps) {
  const {
    title,
    icon,
    closable = false,
    draggable = false,
    resizable = false,
    glass = false,
    glassBlur = 12,
    glassOpacity = 0.85,
    width = 'auto',
    height = 'auto',
    minWidth = 200,
    minHeight = 100,
    defaultPosition,
    onClose,
    onResize,
    className = '',
    children,
  } = props;

  const [position, setPosition] = useState(defaultPosition ?? { x: 0, y: 0 });
  const [size, setSize] = useState({
    w: typeof width === 'number' ? width : 400,
    h: typeof height === 'number' ? height : 300,
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // 拖拽逻辑（pointer events）
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!draggable) return;
    dragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [draggable, position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
    if (resizing.current) {
      setSize(prev => ({
        w: Math.max(minWidth, e.clientX - (panelRef.current?.getBoundingClientRect().left ?? 0)),
        h: Math.max(minHeight, e.clientY - (panelRef.current?.getBoundingClientRect().top ?? 0)),
      }));
    }
  }, [minWidth, minHeight]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    resizing.current = false;
    onResize?.(size.w, size.h);
  }, [onResize, size]);

  // 缩放逻辑
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (!resizable) return;
    e.stopPropagation();
    resizing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [resizable]);

  const panelClassName = [
    'reui-panel',
    glass ? 'reui-panel--glass' : '',
    draggable ? 'reui-panel--draggable' : '',
    className,
  ].filter(Boolean).join(' ');

  const panelStyle: React.CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px)`,
    width: typeof width === 'number' ? width : width,
    height: typeof height === 'number' ? height : height,
    minWidth,
    minHeight,
    willChange: 'transform',
    // Glass 参数化
    ...(glass ? {
      background: `rgba(15, 15, 20, ${glassOpacity})`,
      backdropFilter: `blur(${glassBlur}px)`,
      WebkitBackdropFilter: `blur(${glassBlur}px)`,
    } as React.CSSProperties : {}),
  };

  return (
    <div
      ref={panelRef}
      className={panelClassName}
      style={panelStyle}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* 标题栏 */}
      {(title || icon || closable) && (
        <div
          className="reui-panel__header"
          onPointerDown={handlePointerDown}
          style={draggable ? { cursor: 'grab' } : undefined}
        >
          {icon && <span className="reui-panel__icon">{icon}</span>}
          {title && <span className="reui-panel__title">{title}</span>}
          {closable && (
            <button
              className="reui-panel__close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="reui-panel__body">
        {children}
      </div>

      {/* 缩放手柄 */}
      {resizable && (
        <div
          className="reui-panel__resize-handle"
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  );
}
