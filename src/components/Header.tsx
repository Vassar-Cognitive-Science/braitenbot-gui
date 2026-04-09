import type { SerialState } from '../types';

interface HeaderProps {
  serialState: SerialState;
  onConnect: () => void;
  onDisconnect: () => void;
  serialSupported: boolean;
}

const STATUS_LABELS: Record<SerialState['status'], string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Error',
};

const STATUS_COLORS: Record<SerialState['status'], string> = {
  disconnected: '#888',
  connecting: '#f0a500',
  connected: '#4ecca3',
  error: '#e94560',
};

export function Header({
  serialState,
  onConnect,
  onDisconnect,
  serialSupported,
}: HeaderProps) {
  const isConnected = serialState.status === 'connected';
  const isConnecting = serialState.status === 'connecting';
  const color = STATUS_COLORS[serialState.status];

  return (
    <header className="app-header">
      <div className="header-brand">
        <img src="/icon.svg" alt="BraitenBot logo" className="header-logo" />
        <h1>BraitenBot GUI</h1>
      </div>

      <div className="header-serial">
        {!serialSupported && (
          <span className="serial-unsupported">
            ⚠ Web Serial not supported – use Chrome or Edge
          </span>
        )}
        {serialSupported && (
          <>
            <span
              className="serial-status-dot"
              style={{ background: color }}
              title={serialState.error ?? undefined}
            />
            <span className="serial-status-label" style={{ color }}>
              Arduino: {STATUS_LABELS[serialState.status]}
            </span>
            {serialState.error && (
              <span className="serial-error" title={serialState.error}>
                ⓘ
              </span>
            )}
            {isConnected ? (
              <button
                className="btn btn-outline"
                onClick={onDisconnect}
                disabled={isConnecting}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={onConnect}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting…' : 'Connect Arduino'}
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
