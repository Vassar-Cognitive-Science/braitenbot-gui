import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import releaseData from '../data/latest-release.json';
import styles from './install.module.css';

type Asset = { name: string; url: string };
type ReleaseData = {
  version: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  assets: Partial<Record<'macos-arm64' | 'macos-x64' | 'windows', Asset>>;
};

const release = releaseData as ReleaseData;

const PLATFORMS: { key: keyof ReleaseData['assets']; label: string; hint: string }[] = [
  { key: 'macos-arm64', label: 'macOS (Apple Silicon)', hint: 'M1/M2/M3 and newer' },
  { key: 'macos-x64', label: 'macOS (Intel)', hint: '2020 and earlier Macs' },
  { key: 'windows', label: 'Windows', hint: '64-bit installer' },
];

function DownloadButtons() {
  const hasAssets = Object.keys(release.assets).length > 0;

  if (!hasAssets) {
    return (
      <div className={styles.fallback}>
        <p>
          Downloads will appear here as soon as the first release is published.
          In the meantime, you can browse all releases on GitHub.
        </p>
        <Link className="button button--primary button--lg" to={release.releaseUrl}>
          View releases on GitHub
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {PLATFORMS.map(({ key, label, hint }) => {
        const asset = release.assets[key];
        return (
          <div className={styles.platformCard} key={key}>
            <h3 className={styles.platformLabel}>{label}</h3>
            <p className={styles.platformHint}>{hint}</p>
            {asset ? (
              <>
                <Link className="button button--primary button--block" to={asset.url}>
                  Download
                </Link>
                <code className={styles.assetName}>{asset.name}</code>
              </>
            ) : (
              <p className={styles.unavailable}>Not available in this release</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Install(): React.ReactElement {
  return (
    <Layout title="Install" description="Download BraitenBot for macOS and Windows.">
      <main className="container margin-vert--xl">
        <h1>Install BraitenBot</h1>
        <p className={styles.lede}>
          BraitenBot is a desktop app. Download the build for your platform;
          it bundles everything you need, including the visual editor and the
          Arduino upload tooling.
          {release.version ? (
            <>
              {' '}
              Latest version: <strong>{release.version}</strong>.
            </>
          ) : null}
        </p>

        <DownloadButtons />

        <p className={styles.allReleases}>
          Looking for an older version or Linux builds?{' '}
          <Link to={release.releaseUrl}>Browse all releases on GitHub →</Link>
        </p>

        <hr />

        <h2>After downloading</h2>
        <p>
          The app is not yet code-signed, so your operating system will warn you
          the first time you open it. This is expected. Here is how to get past
          it.
        </p>

        <h3>macOS</h3>
        <ol>
          <li>Open the <code>.dmg</code> and drag <strong>BraitenBot GUI</strong> into Applications.</li>
          <li>
            If you see <em>"BraitenBot GUI is damaged"</em> or <em>"cannot be opened"</em>,
            open Terminal and run:
            <pre>
              <code>xattr -cr "/Applications/BraitenBot GUI.app"</code>
            </pre>
          </li>
          <li>
            Alternatively, go to{' '}
            <strong>System Settings → Privacy &amp; Security</strong> and click
            <strong> Open Anyway</strong> after the first launch attempt.
          </li>
        </ol>

        <h3>Windows</h3>
        <ol>
          <li>Run the downloaded <code>-setup.exe</code> installer.</li>
          <li>
            If Windows SmartScreen shows <em>"Windows protected your PC"</em>,
            click <strong>More info → Run anyway</strong>.
          </li>
        </ol>
      </main>
    </Layout>
  );
}
