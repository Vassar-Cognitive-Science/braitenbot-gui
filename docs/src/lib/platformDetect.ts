import type { PlatformKey } from './releaseAssets';

/**
 * Best-guess visitor platform, used to pick which download the install modal
 * leads with. `'linux-or-other-desktop'` covers desktop platforms we don't
 * ship a build for (Linux, ChromeOS); `'unknown'` covers SSR and any UA we
 * can't classify. This is a hint for copy/CTA selection, not a security or
 * compatibility check — always leave a path to `/install` for the visitor to
 * self-correct.
 */
export type VisitorPlatform = PlatformKey | 'linux-or-other-desktop' | 'mobile' | 'unknown';

/**
 * SSR-safe UA sniff. Mobile is checked first because iPadOS 13+ reports a
 * desktop Macintosh UA string — the touch-points check catches it before it
 * would otherwise fall through to the `macos-arm64` branch.
 */
export function detectVisitorPlatform(): VisitorPlatform {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const ua = navigator.userAgent;

  const isMobile =
    /iPad|iPhone|iPod|Android/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isMobile) {
    return 'mobile';
  }

  if (/Win/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'macos-arm64';
  if (/CrOS|Linux/.test(ua)) return 'linux-or-other-desktop';
  return 'unknown';
}

type UserAgentDataLike = {
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

/**
 * Refines an initial `macos-arm64` guess to `macos-x64` when the browser
 * exposes `navigator.userAgentData` (Chromium only — Safari/Firefox don't
 * implement the Client Hints API). Never throws and never blocks first
 * paint: callers should render the Apple Silicon default immediately and
 * swap in the result of this async call if it resolves differently.
 */
export async function refineMacArchitecture(): Promise<'macos-arm64' | 'macos-x64' | null> {
  try {
    const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
      .userAgentData;
    if (!uaData?.getHighEntropyValues) {
      return null;
    }
    const { architecture } = await uaData.getHighEntropyValues(['architecture']);
    if (architecture === 'arm') return 'macos-arm64';
    if (architecture === 'x86') return 'macos-x64';
    return null;
  } catch {
    return null;
  }
}
