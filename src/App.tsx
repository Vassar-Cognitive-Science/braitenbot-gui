import { useEffect } from 'react';
import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import { SetupModal } from './components/SetupModal';
import { useArduino } from './hooks/useArduino';
import { useAppSettings } from './settings/appSettings';
import { sessionManager } from './collab/SessionManager';
import { resolveRelayUrl } from './collab/config';
import './App.css';

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
        <BraitenbergDiagram
          arduino={arduino}
          appSettings={appSettings}
          updateAppSettings={updateAppSettings}
        />
      </main>
      <SetupModal arduino={arduino} />
    </div>
  );
}
