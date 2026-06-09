/**
 * Radio —— antd Radio 封装层（RFC-004 §3.3 A）。
 *
 * 按钮组单选；修 typo 类名 ExConpactSelector → ExCompactSelector。
 */

import React from 'react';
import { Radio as AntRadio } from 'antd';
import type { RadioProps as AntRadioProps } from 'antd';

export interface RadioProps extends AntRadioProps {}

/**
 * 基于 antd Radio 的封装组件。
 *
 * @example
 * <Radio.Group>
 *   <Radio value={1}>Option 1</Radio>
 *   <Radio value={2}>Option 2</Radio>
 * </Radio.Group>
 */
export function Radio(props: RadioProps) {
  return <AntRadio {...props} />;
}

Radio.Group = AntRadio.Group;
Radio.Button = AntRadio.Button;
