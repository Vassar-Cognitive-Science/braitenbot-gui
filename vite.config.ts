/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend for the Tauri desktop app. Relative base so the bundled assets
// resolve correctly from Tauri's custom protocol.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [react()],
  test: {
    globals: true,
  },
});
