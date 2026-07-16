import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { isEmbeddedInApp } from '@site/src/lib/appBridge';
import { onOpenInstallModal } from '@site/src/lib/installModal';
import {
  detectVisitorPlatform,
  refineMacArchitecture,
  type VisitorPlatform,
} from '@site/src/lib/platformDetect';
import { getAssetForPlatform, type PlatformKey } from '@site/src/lib/releaseAssets';
import styles from './styles.module.css';

const HEADING_ID = 'braitenbot-install-modal-heading';

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

function isMacPlatform(platform: VisitorPlatform): platform is 'macos-arm64' | 'macos-x64' {
  return platform === 'macos-arm64' || platform === 'macos-x64';
}

/**
 * "Get the app" modal, rendered by `Root` on every page but opened only on
 * demand: the homepage "I'm a student" CTA triggers it by calling
 * `openInstallModal()`. This component just subscribes and reacts.
 *
 * Never shown: inside the desktop app's Lessons iframe (`isEmbeddedInApp`,
 * telling a user inside the app to install the app is absurd), or on the
 * `/install` page itself (redundant with the page's own content).
 */
export default function InstallModal(): ReactNode {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<VisitorPlatform>('unknown');

  const location = useLocation();
  const installUrl = useBaseUrl('/install');
  const isInstallRoute = normalizePath(location.pathname) === normalizePath(installUrl);

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  // Subscribe to the shared "open the install modal" signal. Fired by the
  // homepage's "I'm a student" CTA (see src/lib/installModal.ts).
  useEffect(() => {
    return onOpenInstallModal(() => {
      if (isEmbeddedInApp) return;

      const detected = detectVisitorPlatform();
      setPlatform(detected);
      setOpen(true);

      if (detected === 'macos-arm64') {
        refineMacArchitecture().then((refined) => {
          if (refined) setPlatform(refined);
        });
      }
    });
  }, []);

  // If the visitor navigates to /install while the modal is open (nav bar,
  // footer link, the modal's own "Visit the Install page" link, browser
  // back/forward…), close it without treating that as a dismissal: they may
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

  if (!open) {
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
          On this device, everything runs right here, no install needed. To
          upload a circuit onto a real robot, pair up with a classmate on a
          laptop.
        </p>
        <div className={styles.actions}>
          <Link
            ref={primaryRef as React.Ref<HTMLAnchorElement>}
            className="button button--primary button--lg"
            to="/docs/"
            onClick={onDismiss}
          >
            Continue in browser
          </Link>
        </div>
      </>
    );
  }

  const body =
    "You can keep reading right here in your browser. To upload a circuit onto a real robot, you'll need the app: it's the only way to program the hardware, and it works offline too.";

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
          <Link
            className="button button--secondary button--lg"
            to="/docs/"
            onClick={onDismiss}
          >
            Continue in browser
          </Link>
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
        <Link className="button button--secondary button--lg" to="/docs/" onClick={onDismiss}>
          Continue in browser
        </Link>
      </div>
      {altAsset ? (
        <Link className={styles.altLink} to={altAsset.url} onClick={onDismiss}>
          {altLabel}
        </Link>
      ) : null}
    </>
  );
}
