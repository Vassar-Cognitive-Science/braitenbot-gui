import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { HomeIcon, EditorIcon } from './icons';

// Matches the docs footer's established "start of lessons" deep link. The
// `?bb-app=1` query param is read once by docs/src/lib/appBridge.ts to flip
// on the in-app "Open in Editor" button and suppress the native context menu.
//
// Vite's static middleware never resolves a directory URL (with or without
// trailing slash) to its index.html — such requests fall through to the SPA
// fallback, which serves the APP's own index.html into the iframe
// (app-inside-app). The stagedDocsDirectoryIndexes plugin in vite.config.ts
// rewrites these requests in dev; the packaged Tauri protocol does its own
// index.html resolution. Docusaurus navigation is client-side from here.
const LESSONS_START_URL = '/braitenbot-gui/docs/lessons/your-first-vehicle/?bb-app=1';
// The probe must name the file explicitly and verify the BODY, not just the
// status: the same SPA fallback answers 200 with the app's index.html for any
// unknown path, so a status check alone can never observe 'missing'.
const LESSONS_PROBE_URL = '/braitenbot-gui/docs/lessons/your-first-vehicle/index.html';
// Stable marker present in every Docusaurus-built page (the generator meta
// tag / root div id) and absent from the app's own index.html.
const DOCUSAURUS_MARKER = '__docusaurus';

type BundleStatus = 'checking' | 'ok' | 'missing';

interface LessonsViewProps {
  iframeRef: RefObject<HTMLIFrameElement>;
  onGoHome: () => void;
  /** Progressive unlock: only set once the student has unlocked the editor
   *  from lesson 8 (see App.tsx's 'braitenbot:open-editor' listener). Absent
   *  before that — the landing screen stays the only route to the editor. */
  onGoToEditor?: () => void;
}

export function LessonsView({ iframeRef, onGoHome, onGoToEditor }: LessonsViewProps) {
  // The docs site is bundled at build time (scripts/stage-docs.mjs) into
  // public/braitenbot-gui/. In a dev checkout where docs/build was never
  // produced, that copy step no-ops (--soft) and the bundle is absent — show
  // a clear in-app notice instead of the SPA fallback's app-inside-app.
  const [status, setStatus] = useState<BundleStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(LESSONS_PROBE_URL);
        // res.ok alone is not enough: when the bundle is missing, the dev
        // server's SPA fallback still answers 200 — with the app's own
        // index.html. Only a body that carries the Docusaurus marker proves
        // the staged docs are really there.
        const ok = res.ok && (await res.text()).includes(DOCUSAURUS_MARKER);
        if (!cancelled) setStatus(ok ? 'ok' : 'missing');
      } catch {
        if (!cancelled) setStatus('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="lessons-view">
      <div className="lessons-toolbar">
        <button
          type="button"
          className="toolbar-btn toolbar-secondary"
          onClick={onGoHome}
          title="Home"
          aria-label="Home"
        >
          <HomeIcon />
        </button>

        {onGoToEditor && (
          <button
            type="button"
            className="toolbar-btn toolbar-secondary"
            onClick={onGoToEditor}
            title="Editor"
            aria-label="Editor"
          >
            <EditorIcon />
          </button>
        )}
      </div>

      {status === 'missing' ? (
        <div className="lessons-missing-notice">
          <p>Lessons aren&apos;t bundled in this build.</p>
          <p>
            Build the docs site first, then rebuild the app: <code>npm run build --prefix docs</code>
          </p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          className="lessons-iframe"
          title="BraitenBot Lessons"
          src={LESSONS_START_URL}
          hidden={status !== 'ok'}
        />
      )}
    </section>
  );
}
