import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Standalone build of the editor as a browser-only "playground", embedded by the
// docs site in an <iframe> (see docs/src/components/EditorEmbed). It reuses the
// app's real components but runs with mode="playground" and a stub arduino, so
// no Tauri code path is hit. Output lands in docs/static/playground/ so
// Docusaurus serves it at <baseUrl>/playground/playground.html.
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs/static/playground',
    // outDir sits outside this config's root (the repo root), so opt in explicitly.
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./playground.html', import.meta.url)),
    },
  },
  plugins: [react()],
});
