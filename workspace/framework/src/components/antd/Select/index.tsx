/**
 * Select —— antd Select 封装层（RFC-004 §3.3 A）。
 *
 * 吸收旧 SelectInput 多选模式。
 * **修复旧库 onChange 恒传 value[1] 的 bug**——多选时回传完整数组而非固定第二项。
 */

import React, { useCallback } from 'react';
import { Select as AntSelect } from 'antd';
import type { SelectProps as AntSelectProps } from 'antd';

export interface SelectOption<T = unknown> {
  label: React.ReactNode;
  value: T;
  disabled?: boolean;
}

export interface SelectProps<T = unknown> {
  /** 是否启用搜索过滤 */
  searchable?: boolean;
  /** 多选模式（吸收旧 SelectInput） */
  multi?: boolean;
  /** 变化回调——修复旧库 bug：多选时返回完整数组 */
  onChange?: (value: T | T[], option: SelectOption<T> | SelectOption<T>[]) => void;
  /** antd Select 原生 props */
  mode?: 'multiple' | 'tags' | undefined;
  showSearch?: boolean;
  options?: SelectOption<T>[];
  [key: string]: any;
}

/**
 * 基于 antd Select 的封装组件。
 *
 * @example
 * <Select options={[{ label: 'A', value: 'a' }]} />
 * <Select multi options={[...]} onChange={(v) => console.log(v)} />
 */
export function Select<T = unknown>(props: SelectProps<T>) {
  const {
    searchable = false,
    multi = false,
    onChange,
    mode,
    showSearch = searchable,
    ...rest
  } = props;

  // 修复：多选时返回完整数组，而非旧库的 value[1]
  const handleChange = useCallback(
    (value: T | T[], option: SelectOption<T> | SelectOption<T>[]) => {
      onChange?.(value, option);
    },
    [onChange],
  );

  const selectMode = multi ? 'multiple' : mode;

  return (
    <AntSelect<T>
      {...rest as AntSelectProps<T>}
      mode={selectMode}
      showSearch={showSearch}
      onChange={handleChange as any}
    />
  );
}

Select.Option = AntSelect.Option;
Select.OptGroup = AntSelect.OptGroup;
