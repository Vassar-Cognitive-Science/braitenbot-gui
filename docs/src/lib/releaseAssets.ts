import releaseData from '../data/latest-release.json';

/**
 * Desktop-platform keys the release pipeline publishes assets for. Kept
 * separate from the broader visitor-platform union in `platformDetect.ts`
 * (which also covers mobile/linux/unknown) — this is strictly "platforms we
 * might have a downloadable asset for."
 */
export type PlatformKey = 'macos-arm64' | 'macos-x64' | 'windows';

export type Asset = { name: string; url: string };

export type ReleaseData = {
  version: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  assets: Partial<Record<PlatformKey, Asset>>;
};

export const release: ReleaseData = releaseData as ReleaseData;

export const PLATFORMS: { key: PlatformKey; label: string; hint: string }[] = [
  { key: 'macos-arm64', label: 'macOS (Apple Silicon)', hint: 'M1/M2/M3 and newer' },
  { key: 'macos-x64', label: 'macOS (Intel)', hint: '2020 and earlier Macs' },
  { key: 'windows', label: 'Windows', hint: '64-bit installer' },
];

/** Looks up the published asset for a platform, if the release has one. */
export function getAssetForPlatform(key: PlatformKey): Asset | undefined {
  return release.assets[key];
}
