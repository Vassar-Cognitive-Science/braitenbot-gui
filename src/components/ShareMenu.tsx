import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/tauri';
import { serialize, type DiagramState } from '../lib/diagramFile';
import { defaultDiagram } from '../doc/defaults';
import { loadPersonalDiagram, savePersonalDiagram } from '../hooks/useDiagramPersistence';
import { sessionManager } from '../collab/SessionManager';
import { useSession } from '../collab/useSession';
import { presenceColor } from '../collab/presence';
import type { Role } from '../collab/protocol';
import { ShareIcon } from './icons';

const NAME_STORAGE_KEY = 'braitenbot-gui:display-name:v1';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    /* ignore storage errors */
  }
}

async function exportDiagramFile(state: DiagramState): Promise<void> {
  const contents = serialize(state);
  if (isTauri()) {
    await invoke<string | null>('save_diagram', { contents });
    return;
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diagram.bbot';
  a.click();
  URL.revokeObjectURL(url);
}

// Native <dialog> driver (mirrors dialogs.tsx).
function useDialogOpen(open: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

type DialogKind = 'start' | 'join' | 'keep' | 'end-confirm' | null;

export interface ShareMenuProps {
  /** Current canonical top-level diagram (host preload, keep-a-copy source). */
  getCurrentState: () => DiagramState;
  /** Swap in a brand-new doc loaded from this state and reset editing UI. */
  applyDiagramFresh: (state: DiagramState) => void;
  isPristine: boolean;
  showToast: (msg: string) => void;
  /** Follow-the-host: only available to a guest once the host publishes a viewport. */
  canFollowHost: boolean;
  followingHost: boolean;
  onToggleFollowHost: () => void;
}

export function ShareMenu({
  getCurrentState,
  applyDiagramFresh,
  isPristine,
  showToast,
  canFollowHost,
  followingHost,
  onToggleFollowHost,
}: ShareMenuProps) {
  const session = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [displayName, setDisplayName] = useState<string>(() => loadName());
  const [joinCode, setJoinCode] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  const inSession =
    session.status === 'hosting' || session.status === 'joined' || session.status === 'reconnecting';

  // The keep-a-copy dialog opens either from a voluntary Leave click (local
  // dialog state; cancellable) or — derived, no effect needed — because the
  // session ended out from under a joined guest.
  const endedNeedsKeepPrompt =
    session.status === 'ended' &&
    !session.isHost &&
    (session.endReason === 'host-left' || session.endReason === 'removed');
  const keepDialogOpen = dialog === 'keep' || endedNeedsKeepPrompt;
  // While the session is still live this is a Leave prompt (cancellable);
  // once it has ended there is nothing to cancel back into.
  const keepContext: 'leave' | 'ended' = session.status === 'ended' ? 'ended' : 'leave';

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Join failures / errors end the session without a keep-a-copy prompt:
  // surface the message as a toast and clear the ended state. (The ended-guest
  // keep prompt is derived above, so no state syncing happens here.)
  const prevStatusRef = useRef(session.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = session.status;
    if (session.status !== 'ended' || prev === 'ended') return;
    if (endedNeedsKeepPrompt) return;
    showToast(session.endMessage ?? 'Session ended.');
    sessionManager.acknowledgeEnd();
  }, [session.status, session.endMessage, endedNeedsKeepPrompt, showToast]);

  const commitName = useCallback((name: string) => {
    setDisplayName(name);
    saveName(name);
  }, []);

  // --- actions -------------------------------------------------------------

  const startSession = useCallback(() => {
    sessionManager.host(getCurrentState(), displayName);
    setDialog(null);
    setMenuOpen(true);
  }, [getCurrentState, displayName]);

  const joinSession = useCallback(() => {
    sessionManager.join(joinCode.trim(), displayName);
    setDialog(null);
  }, [joinCode, displayName]);

  // Leave/ended resolution for guests: exit the session (or acknowledge the
  // end), then restore the given diagram onto a fresh doc.
  const exitSession = useCallback(
    (nextDiagram: DiagramState) => {
      if (sessionManager.getState().status === 'ended') sessionManager.acknowledgeEnd();
      else sessionManager.leave();
      applyDiagramFresh(nextDiagram);
      setDialog(null);
      setMenuOpen(false);
    },
    [applyDiagramFresh],
  );

  const keepCopy = useCallback(() => {
    const state = getCurrentState();
    savePersonalDiagram(state);
    exitSession(state);
    showToast('Session diagram saved as your diagram.');
  }, [getCurrentState, exitSession, showToast]);

  const discardCopy = useCallback(() => {
    exitSession(loadPersonalDiagram() ?? defaultDiagram());
  }, [exitSession]);

  const exportCopy = useCallback(() => {
    void exportDiagramFile(getCurrentState());
  }, [getCurrentState]);

  const endSessionAsHost = useCallback(() => {
    sessionManager.leave();
    setDialog(null);
    setMenuOpen(false);
    showToast('Session ended.');
  }, [showToast]);

  const copyCode = useCallback(() => {
    if (session.code) {
      void navigator.clipboard.writeText(session.code);
      showToast('Session code copied.');
    }
  }, [session.code, showToast]);

  // --- render helpers ------------------------------------------------------

  const buttonLabel =
    session.status === 'hosting'
      ? `Hosting ${session.code ?? '…'}`
      : session.status === 'joined'
        ? 'In session'
        : session.status === 'requesting'
          ? 'Joining…'
          : session.status === 'reconnecting'
            ? 'Reconnecting…'
            : 'Share';

  const dotStatus = !inSession
    ? null
    : session.connected
      ? 'synced'
      : session.status === 'reconnecting'
        ? 'reconnecting'
        : 'offline';

  const startDialogRef = useDialogOpen(dialog === 'start');
  const joinDialogRef = useDialogOpen(dialog === 'join');
  const keepDialogRef = useDialogOpen(keepDialogOpen);
  const endDialogRef = useDialogOpen(dialog === 'end-confirm');

  const participantRows = session.participants.map((p) => (
    <li key={p.id} className="session-participant">
      <span className="session-participant-name">
        <span
          className="session-participant-swatch"
          style={{ background: presenceColor(p.id) }}
          aria-hidden="true"
        />
        {p.name}
        {p.isHost && <span className="session-participant-host"> (host)</span>}
        {p.id === session.selfId && <span className="session-participant-you"> — you</span>}
      </span>
      {session.isHost && !p.isHost ? (
        <span className="session-participant-controls">
          <select
            className="session-role-select"
            value={p.role}
            onChange={(e) => sessionManager.setRole(p.id, e.target.value as Role)}
            title="Participant role — View disables all their editing and trace inputs"
          >
            <option value="edit">Edit</option>
            <option value="view">View</option>
          </select>
          <button
            type="button"
            className="session-remove-btn"
            onClick={() => sessionManager.removeParticipant(p.id)}
            title={`Remove ${p.name} from the session`}
          >
            ✕
          </button>
        </span>
      ) : (
        <span className="session-participant-role">{p.role === 'view' ? 'view' : 'edit'}</span>
      )}
    </li>
  ));

  return (
    <div className="toolbar-group toolbar-share" ref={menuRef}>
      <span className="toolbar-group-label">Share</span>
      <div className="toolbar-split">
        <button
          type="button"
          className={`toolbar-btn toolbar-secondary ${inSession ? 'active' : ''}`.trim()}
          onClick={() => setMenuOpen((open) => !open)}
          title="Collaborative session"
        >
          <ShareIcon />
          <span>{buttonLabel}</span>
          {dotStatus && <span className="session-status-dot" data-status={dotStatus} />}
        </button>

        {menuOpen && (
          <div className="toolbar-split-menu session-menu" role="menu">
            {session.status === 'idle' && (
              <>
                <button
                  type="button"
                  className="toolbar-split-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog('start');
                  }}
                >
                  Start session
                </button>
                <button
                  type="button"
                  className="toolbar-split-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setJoinCode('');
                    setDialog('join');
                  }}
                >
                  Join session…
                </button>
              </>
            )}

            {session.status === 'requesting' && (
              <>
                <p className="session-menu-note">Waiting for the host to admit you…</p>
                <button
                  type="button"
                  className="toolbar-split-menu-item"
                  onClick={() => {
                    sessionManager.leave();
                    setMenuOpen(false);
                  }}
                >
                  Cancel request
                </button>
              </>
            )}

            {inSession && (
              <>
                {session.isHost && session.code && (
                  <div className="session-code-row">
                    <span className="session-code" title="Give this code to people joining">
                      {session.code}
                    </span>
                    <button type="button" className="session-copy-btn" onClick={copyCode}>
                      Copy
                    </button>
                  </div>
                )}
                <p className="session-menu-note">
                  {session.connected
                    ? 'Synced'
                    : session.status === 'reconnecting'
                      ? 'Connection lost — reconnecting…'
                      : 'Connecting…'}
                </p>
                <ul className="session-participants">{participantRows}</ul>
                {!session.isHost && (
                  <button
                    type="button"
                    className={`toolbar-split-menu-item ${followingHost ? 'current' : ''}`.trim()}
                    onClick={onToggleFollowHost}
                    disabled={!canFollowHost && !followingHost}
                    title={
                      canFollowHost || followingHost
                        ? 'Track the host’s pan and zoom (manual pan/zoom stops following).'
                        : 'The host has not shared a viewport yet.'
                    }
                  >
                    <span className="toolbar-split-menu-check" aria-hidden="true">
                      {followingHost ? '✓' : ''}
                    </span>
                    Follow host
                  </button>
                )}
                {session.isHost && (
                  <button
                    type="button"
                    className="toolbar-split-menu-item"
                    onClick={() => sessionManager.setLocked(!session.locked)}
                  >
                    {session.locked ? 'Unlock session (allow joins)' : 'Lock session (stop joins)'}
                  </button>
                )}
                {session.isHost ? (
                  <button
                    type="button"
                    className="toolbar-split-menu-item session-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setDialog('end-confirm');
                    }}
                  >
                    End session…
                  </button>
                ) : (
                  <button
                    type="button"
                    className="toolbar-split-menu-item session-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setDialog('keep');
                    }}
                  >
                    Leave session…
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Start-session dialog */}
      <dialog ref={startDialogRef} className="code-dialog session-dialog" onClose={() => setDialog(null)}>
        <div className="code-dialog-inner">
          <h2>Start a session</h2>
          <p className="session-dialog-note">
            Share your current diagram live. You approve each person who joins with the 6-digit
            code.
          </p>
          <label className="session-field">
            Your name
            <input
              type="text"
              value={displayName}
              onChange={(e) => commitName(e.target.value)}
              placeholder="e.g. Prof. Braitenberg"
              autoFocus
            />
          </label>
          <div className="code-dialog-actions">
            <button type="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className="session-primary-btn" onClick={startSession}>
              Start session
            </button>
          </div>
        </div>
      </dialog>

      {/* Join-session dialog */}
      <dialog ref={joinDialogRef} className="code-dialog session-dialog" onClose={() => setDialog(null)}>
        <div className="code-dialog-inner">
          <h2>Join a session</h2>
          <label className="session-field">
            Session code
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              autoFocus
            />
          </label>
          <label className="session-field">
            Your name
            <input
              type="text"
              value={displayName}
              onChange={(e) => commitName(e.target.value)}
              placeholder="Shown to the host"
            />
          </label>
          {!isPristine && (
            <p className="session-dialog-note">
              Joining replaces your canvas with the host's diagram. Your own diagram stays in your
              autosave and comes back when you leave — or export a copy now to be safe.
            </p>
          )}
          <div className="code-dialog-actions">
            {!isPristine && (
              <button type="button" onClick={exportCopy}>
                Export my diagram…
              </button>
            )}
            <button type="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="session-primary-btn"
              onClick={joinSession}
              disabled={joinCode.trim().length !== 6}
            >
              Request to join
            </button>
          </div>
        </div>
      </dialog>

      {/* Keep-a-copy dialog (guest leave / session ended) */}
      <dialog
        ref={keepDialogRef}
        className="code-dialog session-dialog"
        onClose={() => {
          // Fires on Escape and on programmatic close. If nothing was chosen
          // yet, resolve to the safe default: cancel a voluntary leave, or
          // "don't keep" for an already-ended session.
          if (dialog === 'keep') {
            setDialog(null);
            return;
          }
          if (endedNeedsKeepPrompt) discardCopy();
        }}
      >
        <div className="code-dialog-inner">
          <h2>{keepContext === 'leave' ? 'Leave session?' : 'Session ended'}</h2>
          <p className="session-dialog-note">
            {keepContext === 'leave'
              ? 'Keep a copy of the shared diagram before you go?'
              : session.endReason === 'removed'
                ? 'The host removed you from the session. Keep a copy of the shared diagram?'
                : 'The host ended the session. Keep a copy of the shared diagram?'}
          </p>
          <div className="code-dialog-actions">
            {keepContext === 'leave' && (
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            )}
            <button type="button" onClick={exportCopy}>
              Export .bbot…
            </button>
            <button type="button" onClick={discardCopy}>
              Don't keep
            </button>
            <button type="button" className="session-primary-btn" onClick={keepCopy}>
              Keep a copy
            </button>
          </div>
        </div>
      </dialog>

      {/* Host end-session confirm */}
      <dialog ref={endDialogRef} className="code-dialog session-dialog" onClose={() => setDialog(null)}>
        <div className="code-dialog-inner">
          <h2>End session?</h2>
          <p className="session-dialog-note">
            This ends the session for all participants. Guests will be offered a copy of the
            diagram; your diagram stays right here.
          </p>
          <div className="code-dialog-actions">
            <button type="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className="session-danger-btn" onClick={endSessionAsHost}>
              End session
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/**
 * Join-request toasts (host) and the disconnected banner. Rendered at the
 * diagram-layout level so toasts never interrupt a drag — they are corner
 * overlays, not modals.
 */
export function SessionOverlays() {
  const session = useSession();
  return (
    <>
      {session.status === 'reconnecting' && (
        <div className="session-banner" role="status">
          Connection lost — reconnecting to the session… Your edits will sync when you're back.
        </div>
      )}
      {session.joinRequests.length > 0 && (
        <div className="join-toasts">
          {session.joinRequests.map((request) => (
            <div key={request.requestId} className="join-toast" role="alert">
              <span className="join-toast-text">
                <strong>{request.name}</strong> wants to join
              </span>
              <button
                type="button"
                className="join-toast-admit"
                onClick={() => sessionManager.admit(request.requestId)}
              >
                Admit
              </button>
              <button
                type="button"
                className="join-toast-deny"
                onClick={() => sessionManager.deny(request.requestId)}
              >
                Deny
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
