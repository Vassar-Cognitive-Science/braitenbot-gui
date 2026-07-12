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
    // Don't watch the Rust side — Cargo locks build artifacts in
    // src-tauri/target/ mid-compile, which crashes Vite's file watcher
    // with EBUSY on Windows.
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  plugins: [react()],
  test: {
    globals: true,
  },
});
