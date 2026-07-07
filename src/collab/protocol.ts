// Wire protocol for the collaborative-sync relay.
//
// A single WebSocket carries two kinds of frames:
//   * TEXT frames  -> JSON session-protocol messages (defined here).
//   * BINARY frames -> Yjs messages (y-protocols sync + awareness). The relay
//     only forwards binary frames to/from ADMITTED peers; before admission a
//     binary frame is ignored.
//
// This file is intentionally a verbatim copy of `relay/src/protocol.ts` (the
// relay lives under a separate tsconfig). Keep the two in sync.

/** Bumped when the session-protocol message shapes change incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Binary sub-protocol tags (match y-protocols conventions). */
export const messageSync = 0;
export const messageAwareness = 1;

export type Role = 'edit' | 'view';

export interface Participant {
  id: string;
  name: string;
  role: Role;
  isHost: boolean;
}

// --- client -> server ----------------------------------------------------

export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  appVersion: string;
  role: 'host' | 'guest';
  displayName?: string;
  /** Guest join / host or guest reconnect: the room code. */
  code?: string;
  /** Reconnect credential handed out in `hosted` / `admitted`. */
  token?: string;
}

export interface AdmitMessage {
  type: 'admit';
  requestId: string;
  role?: Role;
}

export interface DenyMessage {
  type: 'deny';
  requestId: string;
}

export interface LockMessage {
  type: 'lock';
}

export interface UnlockMessage {
  type: 'unlock';
}

export interface RemoveMessage {
  type: 'remove';
  participantId: string;
}

export interface SetRoleMessage {
  type: 'set-role';
  participantId: string;
  role: Role;
}

export interface LeaveMessage {
  type: 'leave';
}

export type ClientMessage =
  | HelloMessage
  | AdmitMessage
  | DenyMessage
  | LockMessage
  | UnlockMessage
  | RemoveMessage
  | SetRoleMessage
  | LeaveMessage;

// --- server -> client ----------------------------------------------------

export interface HostedMessage {
  type: 'hosted';
  code: string;
  participantId: string;
  token: string;
}

export interface JoinPendingMessage {
  type: 'join-pending';
  requestId: string;
}

export interface JoinRequestMessage {
  type: 'join-request';
  requestId: string;
  name: string;
}

export interface AdmittedMessage {
  type: 'admitted';
  participantId: string;
  role: Role;
  token: string;
}

export interface DeniedMessage {
  type: 'denied';
  message: string;
}

export type RejectReason =
  | 'version-mismatch'
  | 'no-room'
  | 'locked'
  | 'rate-limited'
  | 'bad-handshake';

export interface RejectedMessage {
  type: 'rejected';
  reason: RejectReason;
  message: string;
  hostVersion?: string;
}

export interface RosterMessage {
  type: 'roster';
  participants: Participant[];
  locked: boolean;
}

export interface RemovedMessage {
  type: 'removed';
  message: string;
}

export type SessionEndReason = 'host-left' | 'server-shutdown';

export interface SessionEndedMessage {
  type: 'session-ended';
  reason: SessionEndReason;
  message?: string;
}

export type ServerMessage =
  | HostedMessage
  | JoinPendingMessage
  | JoinRequestMessage
  | AdmittedMessage
  | DeniedMessage
  | RejectedMessage
  | RosterMessage
  | RemovedMessage
  | SessionEndedMessage;
