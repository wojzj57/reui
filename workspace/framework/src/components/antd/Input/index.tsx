/**
 * Input —— antd Input 封装层（RFC-004 §3.3 A）。
 *
 * 吸收旧 Input/Title 的行内可编辑模式。
 * 清理旧 createRef 死代码。
 */

import React, { useState, useRef, useEffect } from 'react';
import { Input as AntInput } from 'antd';
import type { InputProps as AntInputProps } from 'antd';

export interface InputProps extends Omit<AntInputProps, 'onChange'> {
  /** 是否启用行内编辑模式（吸收旧 Title 行为） */
  editable?: boolean;
  /** 编辑模式下的提交回调 */
  onEditSubmit?: (value: string) => void;
  /** 编辑模式下的取消回调 */
  onEditCancel?: () => void;
}

/**
 * 基于 antd Input 的封装组件。
 *
 * @example
 * <Input placeholder="请输入" />
 * <Input.TextArea rows={4} />
 * <Input editable onEditSubmit={(v) => console.log(v)} />
 */
export function Input(props: InputProps) {
  const { editable = false, onEditSubmit, onEditCancel, ...rest } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(rest.value ?? rest.defaultValue ?? '');
  const inputRef = useRef<any>(null);

  // 进入编辑模式时自动聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  if (editable) {
    if (isEditing) {
      return (
        <div className="reui-input-editable">
          <AntInput
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onPressEnter={() => {
              setIsEditing(false);
              onEditSubmit?.(String(editValue));
            }}
            onBlur={() => {
              setIsEditing(false);
              onEditCancel?.();
            }}
            size={rest.size}
          />
        </div>
      );
    }

    return (
      <div
        className="reui-input-display"
        onClick={() => setIsEditing(true)}
      >
        {rest.value ?? rest.defaultValue ?? <span className="reui-input-placeholder">Click to edit</span>}
      </div>
    );
  }

  return <AntInput {...rest} />;
}

Input.TextArea = AntInput.TextArea;
Input.Password = AntInput.Password;
Input.Search = AntInput.Search;
Input.Group = AntInput.Group;
