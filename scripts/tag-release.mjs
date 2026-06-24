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

// Only cut a tag when the HEAD commit actually bumped the version (i.e. a
// merged "Version Packages" PR). The Changesets action runs this publish step
// on EVERY push to main with no pending changesets, so without this guard an
// ordinary push would tag whatever version is in package.json.
const headBumpedVersion = (() => {
  try {
    const diff = run('git diff HEAD~1 HEAD -- package.json');
    return /^\+\s*"version":/m.test(diff);
  } catch {
    return false; // no parent commit (e.g. very first commit) — nothing to release
  }
})();

if (!headBumpedVersion) {
  console.log('HEAD did not change the package version; no release tag.');
  process.exit(0);
}

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
