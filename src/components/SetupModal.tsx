import { useEffect, useRef } from 'react';
import type { useArduino } from '../hooks/useArduino';

type ArduinoState = ReturnType<typeof useArduino>;

interface SetupModalProps {
  arduino: ArduinoState;
}

/**
 * First-run setup overlay. Shown when the bundled arduino-cli is reachable but
 * one or more required board cores (`arduino:avr` for classic UNO/Nano,
 * `arduino:renesas_uno` for UNO R4) have not yet been installed.
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
              BraitenBot GUI needs the Arduino <code>arduino:avr</code> and{' '}
              <code>arduino:renesas_uno</code> toolchains to compile and upload
              sketches to your robot (the classic UNO/Nano and the UNO R4,
              respectively). This is a one-time download and will be cached for
              future launches.
            </p>
            <div className="setup-actions">
              <button type="button" className="primary" onClick={installCore}>
                Install Arduino toolchains
              </button>
            </div>
          </>
        )}
        {isInstalling && (
          <>
            <p>Installing the Arduino toolchains — this may take a few minutes…</p>
            <pre ref={logRef} className="setup-log">
              {installLog || 'Starting…'}
            </pre>
          </>
        )}
        {isDone && (
          <>
            <p className="setup-success">Arduino toolchains installed successfully.</p>
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
