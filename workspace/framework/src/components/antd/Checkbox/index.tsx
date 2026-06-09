/**
 * Checkbox —— antd Checkbox 封装层（RFC-004 §3.3 A）。
 *
 * 主题化；保留 indeterminate 半选状态。
 */

import React from 'react';
import { Checkbox as AntCheckbox } from 'antd';
import type { CheckboxProps as AntCheckboxProps } from 'antd';

export interface CheckboxProps extends Omit<AntCheckboxProps, 'indeterminate'> {
  /** 半选状态（原样透传 antd indeterminate） */
  indeterminate?: boolean;
}

/**
 * 基于 antd Checkbox 的封装组件。
 *
 * @example
 * <Checkbox>Label</Checkbox>
 * <Checkbox indeterminate checked={false} />
 */
export function Checkbox(props: CheckboxProps) {
  return <AntCheckbox {...props} />;
}

Checkbox.Group = AntCheckbox.Group;
