import { useEffect, useRef, useState } from 'react';
import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import { SetupModal } from './components/SetupModal';
import { LandingPage } from './components/LandingPage';
import { LessonsView } from './components/LessonsView';
import { QuickUploadModal } from './components/QuickUploadModal';
import { useArduino } from './hooks/useArduino';
import { useAppSettings } from './settings/appSettings';
import { sessionManager } from './collab/SessionManager';
import { resolveRelayUrl } from './collab/config';
import './App.css';

type View = 'landing' | 'editor' | 'lessons';

// Progressive unlock: cross-nav buttons between Editor and Lessons stay
// hidden until the student explicitly unlocks the editor from inside a
// lesson (lesson 8's "Open the Editor" button — see
// docs/docs/on-the-robot/first-upload.mdx and docs/src/lib/appBridge.ts's
// requestOpenEditor). Once unlocked it stays unlocked, even across relaunch.
const EDITOR_UNLOCKED_KEY = 'braitenbot-gui:editor-unlocked:v1';

function readEditorUnlocked(): boolean {
  try {
    return localStorage.getItem(EDITOR_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  // Personal (per-device) preferences live at the app root: the board picker's
  // auto-swap needs one inside useArduino, and the Settings modal edits them.
  const [appSettings, updateAppSettings] = useAppSettings();
  const arduino = useArduino(appSettings.autoSelectIdentifiedBoard);

  // Push the (optional) personal relay override into the session singleton so
  // the next session hosted/joined uses it. Empty override → built-in default.
  useEffect(() => {
    sessionManager.setRelayUrl(resolveRelayUrl(appSettings.relayUrl));
  }, [appSettings.relayUrl]);

  // View state machine — never persisted; every launch starts at the landing
  // screen. `hasEnteredEditor` / `hasVisitedLessons` latch true on first visit
  // and never reset: each view mounts (at most) once and is thereafter only
  // hidden, not unmounted, so the editor's undo history/autosave/collab
  // session and the Lessons iframe's scroll position/SPA route survive
  // switching back and forth.
  const [view, setView] = useState<View>('landing');
  const [hasEnteredEditor, setHasEnteredEditor] = useState(false);
  const [hasVisitedLessons, setHasVisitedLessons] = useState(false);
  const lessonsIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Lesson circuit awaiting a quick upload (serialized DiagramState from the
  // Lessons iframe); non-null opens QuickUploadModal. `hasRequestedUpload`
  // latches so the Arduino SetupModal gate opens for lesson-only students who
  // never entered the editor (uploading needs the cores too).
  const [quickUploadFile, setQuickUploadFile] = useState<string | null>(null);
  const [hasRequestedUpload, setHasRequestedUpload] = useState(false);
  // Latches true once the student unlocks the editor from lesson 8; persisted
  // so cross-nav buttons stay available on every future launch, not just the
  // one where they were unlocked. Read lazily (init function) so we only ever
  // touch localStorage once, on mount.
  const [editorUnlocked, setEditorUnlocked] = useState(readEditorUnlocked);

  const goHome = () => setView('landing');
  const enterEditor = () => {
    setHasEnteredEditor(true);
    setView('editor');
  };
  const enterLessons = () => {
    setHasVisitedLessons(true);
    setView('lessons');
  };

  // Bridge receiver: the Lessons iframe (docs, see docs/src/lib/appBridge.ts)
  // posts messages for two things — validate the source/origin once, then
  // dispatch on `type`:
  //  - 'braitenbot:upload-to-bot': a lesson's embedded diagram asks for a
  //    quick upload; open QuickUploadModal with the serialized file so the
  //    student flashes the circuit without ever opening the editor.
  //  - 'braitenbot:open-editor': lesson 8's "Open the Editor" button asks to
  //    unlock and switch to the Editor view. Idempotent — clicking it again
  //    later (it stays unlocked) just switches views.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== lessonsIframeRef.current?.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; file?: unknown };
      if (data?.type === 'braitenbot:upload-to-bot') {
        if (typeof data.file !== 'string') return;
        setHasRequestedUpload(true);
        setQuickUploadFile(data.file);
        return;
      }
      if (data?.type === 'braitenbot:open-editor') {
        try {
          localStorage.setItem(EDITOR_UNLOCKED_KEY, '1');
        } catch {
          // localStorage unavailable (privacy mode, etc.) — the unlock still
          // takes effect for the current session via state below, it just
          // won't survive a relaunch.
        }
        setEditorUnlocked(true);
        enterEditor();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // This is a desktop app, not a web page: the native context menu (Print,
  // Reload, Save As, Inspect…) is meaningless here and only leaks through where
  // we don't render our own menu. Suppress it app-wide, but leave it on
  // editable fields so right-click copy/paste on text inputs still works.
  const suppressNativeMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  };

  return (
    <div className="app" onContextMenu={suppressNativeMenu}>
      <main className="app-main">
        {view === 'landing' && (
          <LandingPage onEnterEditor={enterEditor} onEnterLessons={enterLessons} />
        )}

        <div style={{ display: view === 'editor' ? undefined : 'none' }}>
          <BraitenbergDiagram
            arduino={arduino}
            appSettings={appSettings}
            updateAppSettings={updateAppSettings}
            active={view === 'editor'}
            onGoHome={goHome}
            onDiagramOpened={enterEditor}
            onGoToLessons={editorUnlocked ? enterLessons : undefined}
          />
        </div>

        {hasVisitedLessons && (
          <div style={{ display: view === 'lessons' ? undefined : 'none' }}>
            <LessonsView
              iframeRef={lessonsIframeRef}
              onGoHome={goHome}
              onGoToEditor={editorUnlocked ? enterEditor : undefined}
            />
          </div>
        )}
      </main>
      {/* Order + z-index matter: QuickUploadModal (z 900) renders under
          SetupModal (z 1000), so a fresh install's core-setup gate overlays
          the upload dialog until setup completes, then reveals it. */}
      {quickUploadFile !== null && (
        <QuickUploadModal
          file={quickUploadFile}
          onClose={() => setQuickUploadFile(null)}
          arduino={arduino}
        />
      )}
      {(hasEnteredEditor || hasRequestedUpload) && <SetupModal arduino={arduino} />}
    </div>
  );
}
