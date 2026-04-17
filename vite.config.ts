/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Default build is the Tauri desktop frontend (relative base, no PWA).
// Pass `--mode web` to build the installable PWA for GitHub Pages.
export default defineConfig(({ mode }) => {
  const isWeb = mode === 'web';

  return {
    base: isWeb ? '/braitenbot-gui/' : './',
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
    },
    plugins: [
      react(),
      ...(isWeb
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
              manifest: {
                name: 'BraitenBot GUI',
                short_name: 'BraitenBot',
                description:
                  'A graphical interface for programming Braitenberg-style robots via USB/Arduino',
                theme_color: '#1a1a2e',
                background_color: '#0f0f23',
                display: 'standalone',
                icons: [
                  {
                    src: 'icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                  {
                    src: 'icon.svg',
                    sizes: 'any',
                    type: 'image/svg+xml',
                    purpose: 'any maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts-cache',
                      expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
            }),
          ]
        : []),
    ],
    test: {
      globals: true,
    },
  };
});
