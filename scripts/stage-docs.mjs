#!/usr/bin/env node
/**
 * Stages the built Docusaurus site (docs/build) into public/braitenbot-gui/
 * so Vite/Tauri bundle it as a static asset — the in-app "Lessons" view is
 * this site loaded in an iframe, offline, from the app's own origin.
 *
 * Docusaurus's `baseUrl` is `/braitenbot-gui/`, so staging under
 * public/braitenbot-gui/ makes every root-absolute asset URL it emits resolve
 * correctly under both `vite dev` and the Tauri custom protocol.
 *
 * Pass `--soft` to warn and exit 0 when docs/build is missing (dev
 * convenience — `npm run dev` shouldn't hard-fail just because docs haven't
 * been built yet). Without it, a missing docs/build is a hard failure: a
 * production build must not silently ship without the Lessons bundle.
 */
import { existsSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC = join(REPO_ROOT, 'docs', 'build');
const DEST = join(REPO_ROOT, 'public', 'braitenbot-gui');

const soft = process.argv.includes('--soft');

if (!existsSync(SRC)) {
  const message =
    'docs/build is missing — the Lessons view will not be bundled.\n' +
    'Build the docs site first: npm run build --prefix docs';
  if (soft) {
    console.warn(`[stage-docs] ${message}`);
    process.exit(0);
  }
  console.error(`[stage-docs] ${message}`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
cpSync(SRC, DEST, { recursive: true });
console.log(`[stage-docs] staged docs/build -> ${join('public', 'braitenbot-gui')}`);
