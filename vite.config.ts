/// <reference types="vitest" />
import { extname } from 'node:path';
import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';

// The staged docs site (scripts/stage-docs.mjs → public/braitenbot-gui/) uses
// pretty URLs (`lesson-name/` backed by `lesson-name/index.html`). Vite's
// public-dir middleware only serves exact file paths — a directory URL falls
// through to the SPA fallback, which answers with the APP's index.html, so the
// Lessons iframe would render the app inside itself. Rewrite extensionless
// requests under the docs prefix to their index.html before the static
// middleware sees them. (The packaged app doesn't go through this server;
// Tauri's asset resolver does its own index.html resolution.)
const STAGED_DOCS_PREFIX = '/braitenbot-gui/';

function stagedDocsDirectoryIndexes(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url?.startsWith(STAGED_DOCS_PREFIX)) {
      const [pathname, query] = req.url.split('?');
      if (!extname(pathname)) {
        req.url = pathname.replace(/\/?$/, '/index.html') + (query ? `?${query}` : '');
      }
    }
    next();
  };
  return {
    name: 'staged-docs-directory-indexes',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

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
  plugins: [react(), stagedDocsDirectoryIndexes()],
  test: {
    globals: true,
  },
});
