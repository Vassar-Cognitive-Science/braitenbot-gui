import { useEffect, useRef } from 'react';
import type { useArduino } from '../hooks/useArduino';

type ArduinoState = ReturnType<typeof useArduino>;

interface SetupModalProps {
  arduino: ArduinoState;
}

/**
 * First-run setup overlay. Shown when the bundled arduino-cli is reachable
 * but the `arduino:avr` core (avr-gcc + avrdude + avr-libc) has not yet been
 * installed — we need it before we can compile sketches for an Uno/Nano.
 */
export function SetupModal({ arduino }: SetupModalProps) {
  const { coreInstalled, coreInstallStatus, installLog, coreError, installCore, dismissCoreInstall } = arduino;
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-scroll the log to the bottom as new lines stream in.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog]);

  // Only render when the CLI is ready but the AVR core is missing, or an
  // install is actively in progress / just finished.
  const shouldShow =
    coreInstalled === false ||
    coreInstallStatus === 'installing' ||
    coreInstallStatus === 'success' ||
    coreInstallStatus === 'error';

  if (!shouldShow) return null;

  const isInstalling = coreInstallStatus === 'installing';
  const isDone = coreInstallStatus === 'success';
  const isError = coreInstallStatus === 'error';

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="setup-modal">
        <h2 id="setup-title">One-time setup</h2>
        {!isInstalling && !isDone && !isError && (
          <>
            <p>
              BraitenBot GUI needs the Arduino <code>arduino:avr</code> toolchain
              (avr-gcc, avrdude, avr-libc) to compile and upload sketches to your
              robot. This is a one-time download of roughly 200&nbsp;MB and will
              be cached for future launches.
            </p>
            <div className="setup-actions">
              <button type="button" className="primary" onClick={installCore}>
                Install AVR toolchain
              </button>
            </div>
          </>
        )}
        {isInstalling && (
          <>
            <p>Installing the AVR toolchain — this may take a few minutes…</p>
            <pre ref={logRef} className="setup-log">
              {installLog || 'Starting…'}
            </pre>
          </>
        )}
        {isDone && (
          <>
            <p className="setup-success">AVR toolchain installed successfully.</p>
            {installLog && (
              <pre ref={logRef} className="setup-log">
                {installLog}
              </pre>
            )}
            <div className="setup-actions">
              <button type="button" className="primary" onClick={dismissCoreInstall}>
                Continue
              </button>
            </div>
          </>
        )}
        {isError && (
          <>
            <p className="setup-error">Installation failed: {coreError ?? 'unknown error'}</p>
            {installLog && (
              <pre ref={logRef} className="setup-log">
                {installLog}
              </pre>
            )}
            <div className="setup-actions">
              <button type="button" className="primary" onClick={installCore}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
