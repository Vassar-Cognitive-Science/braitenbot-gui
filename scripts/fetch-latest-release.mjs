#!/usr/bin/env node
// Fetches the latest GitHub release and writes docs/src/data/latest-release.json,
// which the docs Install page (docs/src/pages/install.tsx) imports to render
// direct, per-platform download buttons.
//
// The download links are "static but current": this script runs at docs build
// time, and the docs site is rebuilt on every release (see
// .github/workflows/deploy.yml), so the baked-in links always point at the
// newest installers.
//
// Degrades gracefully: if there is no published release yet (or the API call
// fails), it writes a stub that the Install page renders as a link to the
// Releases page. Set GITHUB_TOKEN in the environment to avoid API rate limits.
import { writeFileSync } from 'node:fs';

const REPO = 'Vassar-Cognitive-Science/braitenbot-gui';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const OUT = new URL('../docs/src/data/latest-release.json', import.meta.url);

// Maps a logical platform to a predicate over an asset's filename.
const MATCHERS = {
  'macos-arm64': (n) => n.endsWith('.dmg') && /aarch64|arm64/i.test(n),
  'macos-x64': (n) => n.endsWith('.dmg') && /x64|x86_64|intel/i.test(n),
  windows: (n) => n.endsWith('-setup.exe') || n.endsWith('.exe') || n.endsWith('.msi'),
};

function stub(reason) {
  console.warn(`[fetch-latest-release] ${reason} — writing stub.`);
  return { version: null, releaseUrl: RELEASES_URL, publishedAt: null, assets: {} };
}

async function fetchLatest() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'braitenbot-docs-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  } catch (err) {
    return stub(`request failed: ${err.message}`);
  }
  if (!res.ok) return stub(`GitHub API returned ${res.status}`);

  const release = await res.json();
  const assets = {};
  for (const [platform, matches] of Object.entries(MATCHERS)) {
    // Prefer the first matching asset; for Windows prefer the NSIS -setup.exe.
    const candidates = (release.assets ?? []).filter((a) => matches(a.name));
    const chosen =
      platform === 'windows'
        ? candidates.find((a) => a.name.endsWith('-setup.exe')) ?? candidates[0]
        : candidates[0];
    if (chosen) assets[platform] = { name: chosen.name, url: chosen.browser_download_url };
  }

  return {
    version: release.tag_name ?? null,
    releaseUrl: release.html_url ?? RELEASES_URL,
    publishedAt: release.published_at ?? null,
    assets,
  };
}

const data = await fetchLatest();
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`[fetch-latest-release] wrote ${OUT.pathname} (version: ${data.version ?? 'none'})`);
