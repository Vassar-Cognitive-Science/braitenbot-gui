import { useEffect, useLayoutEffect, useRef } from 'react';

interface SerialMonitorProps {
  /** Port the monitor is bound to, shown in the header (e.g. /dev/ttyACM0). */
  port: string;
  running: boolean;
  lines: string[];
  /** Subtle status note (e.g. "paused for upload"), or null. */
  note: string | null;
  onClear: () => void;
  /** Reconnect the monitor to `port` after a disconnect/pause. */
  onReconnect: () => void;
  /** Stop the monitor and hide the panel. */
  onClose: () => void;
}

/**
 * Slide-up bottom panel showing live serial output from `arduino-cli monitor`.
 * Autoscrolls to the newest line unless the user has scrolled up to read
 * history. Output text is selectable (the app root disables selection).
 */
export function SerialMonitor({
  port,
  running,
  lines,
  note,
  onClear,
  onReconnect,
  onClose,
}: SerialMonitorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the view is pinned to the bottom (true until the user scrolls up).
  const stickRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distanceFromBottom < 24;
  };

  // Keep pinned to the bottom as new lines arrive, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  // Close on Escape for keyboard parity with the dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="serial-monitor" role="region" aria-label="Serial monitor">
      <div className="serial-monitor-header">
        <span
          className="serial-status-dot"
          data-status={running ? 'connected' : 'disconnected'}
        />
        <span className="serial-monitor-title">Serial Monitor</span>
        <span className="serial-monitor-port">{port}</span>
        <span className="serial-monitor-state">
          {running ? '115200 baud' : note ?? 'Disconnected'}
        </span>
        <div className="serial-monitor-actions">
          {!running && (
            <button
              type="button"
              className="toolbar-btn toolbar-secondary"
              onClick={onReconnect}
              title="Reopen the monitor on this port"
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary"
            onClick={onClear}
            title="Clear the output"
          >
            Clear
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary"
            onClick={onClose}
            aria-label="Close serial monitor"
            title="Stop the monitor and close"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`serial-monitor-output ${running ? '' : 'is-disconnected'}`.trim()}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <p className="serial-monitor-empty">
            {running
              ? 'Waiting for serial output…'
              : 'No output. Reconnect to start reading.'}
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="serial-monitor-line">
              {line || ' '}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
