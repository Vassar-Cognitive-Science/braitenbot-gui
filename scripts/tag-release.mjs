#!/usr/bin/env node
// Pushes a git tag matching the current package.json version. Pushing the tag
// is what triggers the multi-platform desktop build in
// .github/workflows/release.yml.
//
// This is run by the Changesets GitHub Action as its "publish" step: once a
// "Version Packages" PR is merged, there are no pending changesets left, so the
// action runs this command. package.json has already been bumped by
// `changeset version`, and src-tauri/tauri.conf.json inherits that version via
// its "version": "../package.json" setting.
//
// Idempotent: if the tag already exists on the remote, it does nothing.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString().trim();

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const tag = `v${pkg.version}`;

const alreadyTagged = run('git ls-remote --tags origin')
  .split('\n')
  .some((line) => line.endsWith(`refs/tags/${tag}`));

if (alreadyTagged) {
  console.log(`Tag ${tag} already exists on origin; nothing to do.`);
  process.exit(0);
}

// The Changesets action normally configures a git identity; set a fallback so
// the annotated tag can be created if it has not.
const ensureConfig = (key, value) => {
  try {
    run(`git config ${key}`);
  } catch {
    execSync(`git config ${key} "${value}"`);
  }
};
ensureConfig('user.email', 'github-actions[bot]@users.noreply.github.com');
ensureConfig('user.name', 'github-actions[bot]');

execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: 'inherit' });
execSync(`git push origin ${tag}`, { stdio: 'inherit' });
console.log(`Pushed tag ${tag}.`);
