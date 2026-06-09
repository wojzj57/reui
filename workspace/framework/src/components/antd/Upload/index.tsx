/**
 * Upload —— antd Upload 封装层（RFC-004 §3.3 A）。
 *
 * **降优先级**（NUI 内上传场景少）；
 * 清理 `enablePaste` 死代码、补事件清理。
 */

import React from 'react';
import { Upload as AntUpload } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';

export interface UploadProps {
  /** 上传动作 URL */
  action?: string;
  /** 文件列表 */
  fileList?: UploadFile[];
  /** 变化回调 */
  onChange?: (fileList: UploadFile[], file: UploadFile) => void;
  /** 其他 antd Upload props */
  [key: string]: any;
}

/**
 * 基于 antd Upload 的封装组件。
 * 清理旧库 enablePaste 死代码，补事件清理。
 *
 * @example
 * <Upload action="/upload" />
 * <Upload.Dragger action="/upload" />
 */
export function Upload(props: UploadProps) {
  const {
    onChange,
    ...rest
  } = props;

  return (
    <AntUpload
      {...rest}
      onChange={(info) => {
        onChange?.(info.fileList, info.file);
      }}
    />
  );
}

Upload.Dragger = AntUpload.Dragger as any;
