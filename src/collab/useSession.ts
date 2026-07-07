import { useSyncExternalStore } from 'react';
import type { SessionManager, SessionState } from './SessionManager';
import { sessionManager } from './SessionManager';
import type { PeerPresence } from './presence';

/** Subscribe to the collaborative-session state (mirrors useDiagramSnapshot). */
export function useSession(manager: SessionManager = sessionManager): SessionState {
  return useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);
}

/** Subscribe to remote peers' presence (selection, drag, cursor, viewport). */
export function usePresence(manager: SessionManager = sessionManager): PeerPresence[] {
  return useSyncExternalStore(manager.subscribePresence, manager.getPresence, manager.getPresence);
}
