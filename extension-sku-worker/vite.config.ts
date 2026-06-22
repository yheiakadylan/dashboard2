import { defineConfig } from 'vite';
import { resolve } from 'path';
// @ts-ignore: Không có declaration file cho module này
import obfuscator from 'rollup-plugin-javascript-obfuscator';

export default defineConfig({
  plugins: [
    obfuscator({
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      renameGlobals: false,
      stringArray: true,
      stringArrayEncoding: ['rc4'],
      stringArrayThreshold: 0.75,
      unicodeEscapeSequence: false,
      disableConsoleOutput: true // Tắt console.log để tránh rò rỉ API/ logic trên máy khách
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
        offscreen: resolve(__dirname, 'src/offscreen.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
