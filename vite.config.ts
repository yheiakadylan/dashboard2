import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
          registerType: 'autoUpdate',
          includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
          manifest: {
            name: 'Sales Dashboard',
            short_name: 'Dashboard',
            description: 'A web-based dashboard to visualize and manage e-commerce sales.',
            theme_color: '#ffffff',
            background_color: '#ffffff',
            display: 'standalone',
            start_url: '/',
            icons: [
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png'
              },
              {
                src: 'pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png'
              }
            ]
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
            maximumFileSizeToCacheInBytes: 4000000,
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
            ],
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});