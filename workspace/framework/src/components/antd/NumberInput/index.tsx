/**
 * NumberInput —— antd InputNumber 封装层（RFC-004 §3.3 A）。
 *
 * 加减按钮；**去掉硬编码 #000**，统一走 token。
 */

import React from 'react';
import { InputNumber as AntInputNumber } from 'antd';
import type { InputNumberProps as AntInputNumberProps } from 'antd';

export interface NumberInputProps extends Omit<AntInputNumberProps, 'onChange'> {
  /** 变化回调 */
  onChange?: (value: number | string | null) => void;
}

/**
 * 基于 antd InputNumber 的封装组件。
 * 去掉旧库硬编码 #000，通过 antd ThemeConfig 统一控制。
 *
 * @example
 * <NumberInput min={0} max={100} defaultValue={50} />
 */
export function NumberInput(props: NumberInputProps) {
  return <AntInputNumber {...props} />;
}
