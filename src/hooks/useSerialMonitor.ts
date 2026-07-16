import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../lib/tauri';

/** Maximum number of retained output lines; oldest are dropped past this. */
const MAX_LINES = 2000;

/**
 * Hook for driving the `arduino-cli monitor` serial viewer through the Tauri
 * backend. Streams incoming lines (capped at {@link MAX_LINES}), and exposes
 * start/stop/clear plus a dedicated "pause for upload" that stops the monitor
 * so it can't hold the serial port during a flash.
 */
export function useSerialMonitor() {
  const tauriAvailable = isTauri();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  // A subtle status note surfaced in the panel, e.g. after an upload pause or a
  // failed start. Cleared on a successful start.
  const [note, setNote] = useState<string | null>(null);

  // Mirror `running` in a ref so callbacks that pause-for-upload can read the
  // latest value without being re-created (which would churn upload handlers).
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const start = useCallback(
    async (port: string) => {
      if (!tauriAvailable) return;
      setNote(null);
      try {
        await invoke<void>('start_serial_monitor', { port });
        setRunning(true);
      } catch (err) {
        setRunning(false);
        setNote(typeof err === 'string' ? err : String(err));
      }
    },
    [tauriAvailable],
  );

  const stop = useCallback(async () => {
    if (!tauriAvailable) return;
    try {
      await invoke<void>('stop_serial_monitor');
    } catch {
      // Best-effort — if the monitor already exited there's nothing to kill.
    }
    setRunning(false);
  }, [tauriAvailable]);

  const clear = useCallback(() => setLines([]), []);

  // Send a line to the board. `arduino-cli monitor` forwards its stdin to the
  // serial port, so this reaches the sketch's `Serial.read()`. A trailing
  // newline is appended if missing so line-based sketch parsers see a complete
  // command. No-op unless a monitor is currently open.
  const send = useCallback(
    async (text: string) => {
      if (!tauriAvailable || !runningRef.current) return;
      const data = text.endsWith('\n') ? text : `${text}\n`;
      try {
        await invoke<void>('write_serial', { data });
      } catch (err) {
        setNote(typeof err === 'string' ? err : String(err));
      }
    },
    [tauriAvailable],
  );

  // Stop the monitor ahead of a compile/upload so it can't hold the serial
  // port (which would make the upload fail). Deliberately does NOT auto-restart
  // afterwards: boards re-enumerate on flash, so reconnection stays manual.
  const pauseForUpload = useCallback(async () => {
    if (!tauriAvailable || !runningRef.current) return;
    try {
      await invoke<void>('stop_serial_monitor');
    } catch {
      // Best-effort.
    }
    setRunning(false);
    setNote('Paused for upload — reopen the monitor when the upload finishes.');
  }, [tauriAvailable]);

  // Subscribe to backend stream + close events for the monitor's lifetime.
  useEffect(() => {
    if (!tauriAvailable) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const track = (fn: UnlistenFn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };

    listen<string>('serial-monitor-line', (event) => {
      setLines((prev) => {
        const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
        // Strip a single trailing newline so each entry renders as one line.
        next.push(event.payload.replace(/\r?\n$/, ''));
        return next;
      });
    }).then(track);

    listen('serial-monitor-closed', () => {
      setRunning(false);
    }).then(track);

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [tauriAvailable]);

  return { running, lines, note, start, stop, clear, send, pauseForUpload };
}
