import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt', // Changed from autoUpdate to prevent reload loop
        devOptions: {
          enabled: false, // Disable in development to prevent MIME type errors
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        manifest: {
          name: 'Sales Dashboard',
          short_name: 'Dashboard',
          description: 'A comprehensive e-commerce sales dashboard for eBay and Etsy sellers.',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          categories: ['business', 'productivity'],
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          maximumFileSizeToCacheInBytes: 4000000,
          // IMPORTANT: Disable skipWaiting to prevent reload loop!
          // With skipWaiting:true + autoUpdate, new SW immediately takes over
          // and triggers reload, creating an infinite loop in production
          skipWaiting: false, // Changed from true to prevent reload loop
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/i\.etsystatic\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'etsy-images',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/i\.ebayimg\.com\/.*/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'ebay-images',
                expiration: {
                  maxEntries: 100, // eBay images might be less common
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            // Cache CDN modules (recharts, react, etc.)
            {
              urlPattern: /^https:\/\/aistudiocdn\.com\/.*/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'cdn-modules',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7 Days
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/esm\.sh\/.*/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'esm-modules',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7 Days
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        }
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
          drop_console: true, // Remove console.logs in production
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
          manualChunks: {
            // React core
            'react-vendor': ['react', 'react-dom'],

            // Firebase
            'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore'],

            // Charts and visualization
            'charts-vendor': ['recharts'],

            // Virtualization
            'virtualization-vendor': ['react-window', 'react-virtualized-auto-sizer'],

            // Google AI
            'ai-vendor': ['@google/genai'],
          },

          // Optimize asset filenames
          assetFileNames: (assetInfo: any) => {
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
      include: ['react', 'react-dom', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'recharts'],
      exclude: ['@google/genai'],
    },
  };
});