import { defineConfig } from 'vite';

// CEF 通过 https://cfx-nui-fivem-entrance/dist/index.html 加载页面，资源引用
// 必须是相对路径（base: './'），否则 / 根路径在 CEF 下会 404。
export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 0, // 不内联，保持产物文件可被 fxmanifest 的 files{} 收录
    target: 'chrome93', // CEF Chromium 基线
  },
});
