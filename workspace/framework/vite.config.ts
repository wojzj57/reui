import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-d.ts', 'tests/**'],
    }),
  ],

  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'theme/index': resolve(__dirname, 'src/theme/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },

    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'antd',
        '@ant-design/icons',
        '@reui/core',
        '@reui/interface',
        'valtio',
      ],
      output: {
        // 将 CSS 资产重命名为 style.css，匹配 package.json 的 exports["./style.css"]
        assetFileNames: (chunkInfo) =>
          chunkInfo.name === 'framework.css' ? 'style.css' : chunkInfo.name!,
      },
    },

    // 单一 CSS 文件，对应 package.json 中的 "./style.css" export
    cssCodeSplit: false,
  },
});
