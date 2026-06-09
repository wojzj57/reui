/**
 * Loading —— antd Spin 封装层（RFC-004 §3.3 A）。
 *
 * 全屏/区域加载；**去掉硬编码 "CAEP" 品牌与中文文案**，文案可配置。
 */

import React from 'react';
import { Spin as AntSpin } from 'antd';

export interface LoadingProps {
  /** 加载提示文案（去掉硬编码 "CAEP" 与中文） */
  tip?: string;
  /** 是否全屏 */
  fullscreen?: boolean;
  /** 自定义加载图标 */
  indicator?: React.ReactNode;
  /** 大小 */
  size?: 'small' | 'default' | 'large';
  /** 是否旋转 */
  spinning?: boolean;
}

/**
 * 基于 antd Spin 的封装组件。
 * 去掉旧库硬编码品牌与中文文案，文案通过 tip 可配置。
 *
 * @example
 * <Loading />
 * <Loading tip="Uploading..." />
 * <Loading fullscreen />
 */
export function Loading(props: LoadingProps) {
  const {
    tip,
    fullscreen = false,
    indicator,
    ...rest
  } = props;

  const spin = (
    <AntSpin
      {...rest}
      tip={tip}
      indicator={indicator as any}
    />
  );

  if (fullscreen) {
    return (
      <div className="reui-loading-fullscreen">
        {spin}
      </div>
    );
  }

  return spin;
}
