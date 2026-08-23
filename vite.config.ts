import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import { execFileSync } from 'node:child_process';

const buildTimestamp = new Date().toISOString();

const appVersion = (() => {
  if (process.env.VERCEL_DEPLOYMENT_ID) return process.env.VERCEL_DEPLOYMENT_ID;
  if (process.env.VERCEL_URL) return process.env.VERCEL_URL;
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return `${process.env.VERCEL_GIT_COMMIT_SHA}-${buildTimestamp}`;
  }
  try {
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return `${commitSha}-${buildTimestamp}`;
  } catch {
    return `build-${buildTimestamp}`;
  }
})();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      watch: {
        ignored: ['**/extension-sku-worker/**'],
      },
    },
    plugins: [
      react(),
      {
        name: 'app-version-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: appVersion }),
          });
        },
      },
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          name: 'Dashboard',
          short_name: 'NHMEDIA',
          description: 'Dashboard sales operations and performance dashboard',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#159AD6',
          icons: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          importScripts: ['/firebase-messaging-sw.js'],
          skipWaiting: false,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallbackDenylist: [/^\/api/],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/.*/,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/wsrv\.nl\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'wsrv-images',
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'firebase-images',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
      // Bundle analyzer (only in build mode)
      mode === 'production' && visualizer({
        open: false,
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
      })
    ].filter(Boolean),
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildTimestamp),
      __APP_VERSION__: JSON.stringify(appVersion),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    build: {
      // Target modern browsers for smaller bundles
      target: 'es2020',

      // Enable minification
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true, // ⚠️ TEMP: Re-enable to true after debugging production issue
          drop_debugger: true,
          passes: 2,
        },
        mangle: true,
        format: {
          comments: false, // Remove comments
        },
      },

      // Enable CSS code splitting
      cssCodeSplit: true,

      // Optimize chunk size
      chunkSizeWarningLimit: 1000,

      // Manual chunk splitting for better caching
      rollupOptions: {
        output: {
          // Optimize asset filenames
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name?.split('.');
            const ext = info?.[info.length - 1];
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext || '')) {
              return `assets/images/[name]-[hash][extname]`;
            } else if (/woff2?|eot|ttf|otf/i.test(ext || '')) {
              return `assets/fonts/[name]-[hash][extname]`;
            }
            return `assets/[name]-[hash][extname]`;
          },
          chunkFileNames: 'js/[name]-[hash].js',
          entryFileNames: 'js/[name]-[hash].js',
        },
      },

      // Source maps for debugging (optional, can disable for faster builds)
      sourcemap: false,

      // Report compressed size
      reportCompressedSize: true,

      // Inline small assets as base64
      assetsInlineLimit: 4096,
    },

    // Optimize dependencies
    optimizeDeps: {
      entries: ['index.html'],
      include: ['react', 'react-dom', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'recharts', 'antd', '@ant-design/icons', 'framer-motion'],
    },
  };
});
