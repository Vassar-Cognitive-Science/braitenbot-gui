import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { isEmbeddedInApp } from '@site/src/lib/appBridge';
import {
  detectVisitorPlatform,
  refineMacArchitecture,
  type VisitorPlatform,
} from '@site/src/lib/platformDetect';
import { getAssetForPlatform, type PlatformKey } from '@site/src/lib/releaseAssets';
import styles from './styles.module.css';

const DISMISSED_KEY = 'braitenbot:install-modal-dismissed-v1';
const HEADING_ID = 'braitenbot-install-modal-heading';

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

function isMacPlatform(platform: VisitorPlatform): platform is 'macos-arm64' | 'macos-x64' {
  return platform === 'macos-arm64' || platform === 'macos-x64';
}

/**
 * First-visit "get the app" modal, rendered by `Root` on every page. Unlike
 * the old `InstallNudge` admonition (lessons-page-only, always visible), this
 * is a site-wide interruption shown once: it decides whether to open on
 * mount, then remembers the visitor's choice in `localStorage` so it never
 * reappears after an explicit dismissal.
 *
 * Never shown: inside the desktop app's Lessons iframe (`isEmbeddedInApp` —
 * telling a user inside the app to install the app is absurd), on the
 * `/install` page itself (redundant with the page's own content), or once
 * the visitor has dismissed it before.
 */
export default function InstallModal(): ReactNode {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<VisitorPlatform>('unknown');

  const location = useLocation();
  const installUrl = useBaseUrl('/install');
  const isInstallRoute = normalizePath(location.pathname) === normalizePath(installUrl);

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement>(null);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable (privacy mode, etc.) — the modal will just
      // reappear next visit, which is an acceptable degradation.
    }
    setOpen(false);
  }, []);

  // Decide once, on mount, whether to open. SSR and the first client render
  // both return null (see below), so flipping `open`/`ready` here client-side
  // only cannot cause a hydration mismatch.
  useEffect(() => {
    if (isEmbeddedInApp) {
      setReady(true);
      return;
    }
    if (isInstallRoute) {
      setReady(true);
      return;
    }
    let dismissed = false;
    try {
      dismissed = Boolean(localStorage.getItem(DISMISSED_KEY));
    } catch {
      dismissed = false;
    }
    if (dismissed) {
      setReady(true);
      return;
    }

    const detected = detectVisitorPlatform();
    setPlatform(detected);
    setOpen(true);
    setReady(true);

    if (detected === 'macos-arm64') {
      refineMacArchitecture().then((refined) => {
        if (refined) setPlatform(refined);
      });
    }
    // Mount-only: this is a one-time decision, not a reactive binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the visitor navigates to /install while the modal is open (nav bar,
  // footer link, the modal's own "Visit the Install page" link, browser
  // back/forward…), close it without treating that as a dismissal — they may
  // come back to a different page later and the modal should still be able
  // to greet them there.
  useEffect(() => {
    if (open && isInstallRoute) {
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismiss]);

  useEffect(() => {
    if (open) {
      primaryRef.current?.focus();
    }
  }, [open]);

  if (!ready || !open) {
    return null;
  }

  return createPortal(
    <div className={styles.backdrop} onClick={dismiss}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close"
          onClick={dismiss}
        >
          ×
        </button>
        <ModalContent platform={platform} primaryRef={primaryRef} onDismiss={dismiss} />
        <p className={styles.footer}>
          <Link to="/install">Visit the Install page</Link>
        </p>
      </div>
    </div>,
    document.body,
  );
}

type ModalContentProps = {
  platform: VisitorPlatform;
  primaryRef: React.Ref<HTMLElement>;
  onDismiss: () => void;
};

function ModalContent({ platform, primaryRef, onDismiss }: ModalContentProps): ReactNode {
  if (platform === 'mobile') {
    return (
      <>
        <h2 id={HEADING_ID} className={styles.heading}>
          Take BraitenBot home
        </h2>
        <p className={styles.body}>
          On this device, everything runs right here — no install needed. To
          upload a circuit onto a real robot, pair up with a classmate on a
          laptop.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            ref={primaryRef as React.Ref<HTMLButtonElement>}
            className="button button--primary button--lg"
            onClick={onDismiss}
          >
            Continue
          </button>
        </div>
      </>
    );
  }

  const body =
    'Every lesson runs right here in your browser. The desktop app is only for one thing: putting what you build onto a real robot.';

  if (platform === 'linux-or-other-desktop' || platform === 'unknown') {
    return (
      <>
        <h2 id={HEADING_ID} className={styles.heading}>
          Take BraitenBot home
        </h2>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <Link
            ref={primaryRef as React.Ref<HTMLAnchorElement>}
            className="button button--primary button--lg"
            to="/install"
            onClick={onDismiss}
          >
            See install options
          </Link>
          <button
            type="button"
            className="button button--secondary button--lg"
            onClick={onDismiss}
          >
            Continue in browser
          </button>
        </div>
      </>
    );
  }

  // windows / macos-arm64 / macos-x64
  const isMac = isMacPlatform(platform);
  const asset = getAssetForPlatform(platform as PlatformKey);
  const platformLabel = platform === 'windows' ? 'Windows' : 'Mac';

  const altArch: PlatformKey | null = isMac
    ? platform === 'macos-arm64'
      ? 'macos-x64'
      : 'macos-arm64'
    : null;
  const altAsset = altArch ? getAssetForPlatform(altArch) : undefined;
  const altLabel =
    altArch === 'macos-x64' ? 'Not this Mac? Get the Intel build' : 'Not this Mac? Get the Apple Silicon build';

  return (
    <>
      <h2 id={HEADING_ID} className={styles.heading}>
        Take BraitenBot home
      </h2>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        {asset ? (
          <Link
            ref={primaryRef as React.Ref<HTMLAnchorElement>}
            className="button button--primary button--lg"
            to={asset.url}
            onClick={onDismiss}
          >
            Download for {platformLabel}
          </Link>
        ) : (
          <Link
            ref={primaryRef as React.Ref<HTMLAnchorElement>}
            className="button button--primary button--lg"
            to="/install"
            onClick={onDismiss}
          >
            See install options
          </Link>
        )}
        <button type="button" className="button button--secondary button--lg" onClick={onDismiss}>
          Continue in browser
        </button>
      </div>
      {altAsset ? (
        <Link className={styles.altLink} to={altAsset.url} onClick={onDismiss}>
          {altLabel}
        </Link>
      ) : null}
    </>
  );
}
