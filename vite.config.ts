/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// When building for Tauri, use a relative base and skip PWA registration.
// When building for GitHub Pages, use the `/braitenbot-gui/` base and enable PWA.
export default defineConfig(({ mode }) => ({
  base: mode === 'tauri' ? './' : '/braitenbot-gui/',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias:
      mode === 'tauri'
        ? {
            'virtual:pwa-register': fileURLToPath(
              new URL('./src/pwa-register-stub.ts', import.meta.url),
            ),
          }
        : undefined,
  },
  plugins: [
    react(),
    ...(mode === 'tauri'
      ? []
      : [
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
        ]),
  ],
  test: {
    globals: true,
  },
}));
