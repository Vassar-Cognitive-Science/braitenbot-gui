#!/usr/bin/env node
/**
 * Downloads arduino-cli and places it in src-tauri/binaries/ with the
 * Tauri-required target-triple naming convention for use as a sidecar.
 *
 * By default, fetches only the current host platform. Pass `--all` to
 * fetch every supported platform (useful for CI release builds).
 * Pass `--force` to re-download even if the binary already exists.
 */
import {
  existsSync,
  mkdirSync,
  chmodSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BINARIES_DIR = join(REPO_ROOT, 'src-tauri', 'binaries');
const DOWNLOAD_BASE = 'https://downloads.arduino.cc/arduino-cli';

// Map Node (platform-arch) to Arduino download suffix, Rust target triple,
// archive format, and the name of the extracted binary.
const PLATFORMS = {
  'darwin-arm64': {
    arduinoSuffix: 'macOS_ARM64.tar.gz',
    targetTriple: 'aarch64-apple-darwin',
    format: 'tar.gz',
    binaryName: 'arduino-cli',
  },
  'darwin-x64': {
    arduinoSuffix: 'macOS_64bit.tar.gz',
    targetTriple: 'x86_64-apple-darwin',
    format: 'tar.gz',
    binaryName: 'arduino-cli',
  },
  'linux-x64': {
    arduinoSuffix: 'Linux_64bit.tar.gz',
    targetTriple: 'x86_64-unknown-linux-gnu',
    format: 'tar.gz',
    binaryName: 'arduino-cli',
  },
  'linux-arm64': {
    arduinoSuffix: 'Linux_ARM64.tar.gz',
    targetTriple: 'aarch64-unknown-linux-gnu',
    format: 'tar.gz',
    binaryName: 'arduino-cli',
  },
  'win32-x64': {
    arduinoSuffix: 'Windows_64bit.zip',
    targetTriple: 'x86_64-pc-windows-msvc',
    format: 'zip',
    binaryName: 'arduino-cli.exe',
  },
};

function currentPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function sidecarPath(spec) {
  const isExe = spec.binaryName.endsWith('.exe');
  const stem = isExe ? spec.binaryName.slice(0, -4) : spec.binaryName;
  const ext = isExe ? '.exe' : '';
  return join(BINARIES_DIR, `${stem}-${spec.targetTriple}${ext}`);
}

async function fetchPlatform(platformKey, { force }) {
  const spec = PLATFORMS[platformKey];
  if (!spec) {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }

  const outputPath = sidecarPath(spec);
  if (existsSync(outputPath) && !force) {
    console.log(`✓ ${platformKey} already present → ${outputPath}`);
    return;
  }

  const url = `${DOWNLOAD_BASE}/arduino-cli_latest_${spec.arduinoSuffix}`;
  console.log(`↓ ${platformKey}  ${url}`);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const workDir = join(tmpdir(), `braitenbot-arduino-cli-${platformKey}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archiveName = spec.format === 'tar.gz' ? 'archive.tar.gz' : 'archive.zip';
  const archivePath = join(workDir, archiveName);
  await writeFile(archivePath, buffer);

  // `tar` on macOS and Linux (bsdtar) handles both tar.gz and zip archives.
  // Windows 10+ ships with bsdtar-based `tar` as well.
  const tarArgs =
    spec.format === 'tar.gz'
      ? ['-xzf', archivePath, '-C', workDir]
      : ['-xf', archivePath, '-C', workDir];
  const extract = spawnSync('tar', tarArgs, { stdio: 'inherit' });
  if (extract.status !== 0) {
    throw new Error(`Failed to extract ${archivePath} (exit ${extract.status})`);
  }

  const extractedBin = join(workDir, spec.binaryName);
  if (!existsSync(extractedBin)) {
    throw new Error(
      `Extracted archive did not contain expected binary: ${spec.binaryName}`,
    );
  }

  mkdirSync(BINARIES_DIR, { recursive: true });
  copyFileSync(extractedBin, outputPath);
  if (!spec.binaryName.endsWith('.exe')) {
    chmodSync(outputPath, 0o755);
  }

  // Copy the arduino-cli LICENSE alongside the binary to satisfy GPL-3.0
  // attribution when the app is bundled.
  const licenseSrc = join(workDir, 'LICENSE.txt');
  const licenseDst = join(BINARIES_DIR, 'LICENSE-arduino-cli.txt');
  if (existsSync(licenseSrc) && !existsSync(licenseDst)) {
    copyFileSync(licenseSrc, licenseDst);
  }

  rmSync(workDir, { recursive: true, force: true });

  console.log(`✓ ${platformKey}  → ${outputPath}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const fetchAll = args.has('--all');
  const force = args.has('--force');

  const targets = fetchAll ? Object.keys(PLATFORMS) : [currentPlatformKey()];

  for (const key of targets) {
    if (!PLATFORMS[key]) {
      console.error(`✗ Unsupported host platform: ${key}`);
      console.error(
        `  Supported: ${Object.keys(PLATFORMS).join(', ')}`,
      );
      process.exit(1);
    }
    await fetchPlatform(key, { force });
  }
}

main().catch((err) => {
  console.error('fetch-arduino-cli failed:', err.message ?? err);
  process.exit(1);
});
