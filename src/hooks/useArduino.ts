import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../lib/tauri';

/** Detected Arduino board, as returned by the Rust `list_boards` command. */
export interface BoardInfo {
  port: string;
  protocol: string;
  name: string | null;
  fqbn: string | null;
}

export interface UploadResult {
  success: boolean;
  compileOutput: string;
  uploadOutput: string;
  /**
   * Set when the flow failed before producing compile/upload output — e.g. an
   * invoke-level rejection (sidecar missing, bad args) or a user cancellation.
   * Rendered as a plain message rather than under a compile/upload heading.
   */
  errorMessage: string | null;
}

type RustUploadResult = {
  success: boolean;
  compile_output: string;
  upload_output: string;
};

export type UploadStatus = 'idle' | 'compiling' | 'uploading' | 'success' | 'error';

/**
 * Fine-grained compile/upload progress from the Rust backend. `percent` is null
 * when the underlying tool reports no percentage (compiling, or an uploader that
 * prints no progress bar) — the UI shows an indeterminate bar then.
 */
export interface UploadProgress {
  phase: 'compile' | 'upload';
  percent: number | null;
}

export type CoreInstallStatus = 'idle' | 'checking' | 'installing' | 'success' | 'error';

/**
 * A connected Arduino-like USB device whose Windows driver is missing or
 * broken, as returned by the Rust `check_driver_issue` command. Always null
 * on non-Windows platforms.
 */
export interface DriverIssue {
  deviceName: string;
  errorCode: number;
}

export type DriverInstallStatus = 'idle' | 'installing' | 'error';

/**
 * Hook for driving arduino-cli through the Tauri backend. Handles board
 * detection and the compile-then-upload flow.
 */
export function useArduino(autoSelectIdentifiedBoard: boolean) {
  const tauriAvailable = isTauri();
  const [cliAvailable, setCliAvailable] = useState<boolean>(false);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<BoardInfo | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const [coreInstalled, setCoreInstalled] = useState<boolean | null>(null);
  const [coreInstallStatus, setCoreInstallStatus] = useState<CoreInstallStatus>('idle');
  const [installLog, setInstallLog] = useState<string>('');
  const [coreError, setCoreError] = useState<string | null>(null);
  const [driverIssue, setDriverIssue] = useState<DriverIssue | null>(null);
  const [driverInstallStatus, setDriverInstallStatus] = useState<DriverInstallStatus>('idle');
  const [driverError, setDriverError] = useState<string | null>(null);

  // Pending "reset status back to idle" timer, kept so a rapid second upload
  // can clear the previous one instead of having its status clobbered mid-run.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set while a cancel is in flight so the resolving runUpload can report it as
  // a cancellation rather than a normal failure.
  const cancelledRef = useRef(false);

  const checkCli = useCallback(async () => {
    if (!tauriAvailable) {
      setCliAvailable(false);
      setCliVersion(null);
      return;
    }
    try {
      const version = await invoke<string>('check_arduino_cli');
      setCliVersion(version);
      setCliAvailable(true);
      setCliError(null);
    } catch (err) {
      setCliAvailable(false);
      setCliVersion(null);
      setCliError(typeof err === 'string' ? err : String(err));
    }
  }, [tauriAvailable]);

  const refreshBoards = useCallback(async () => {
    if (!tauriAvailable) return;
    try {
      const detected = await invoke<BoardInfo[]>('list_boards');
      setBoards(detected);
      setSelectedBoard((current) => {
        const stillPresent = current != null && detected.some((b) => b.port === current.port);
        const firstIdentified = detected.find((b) => b.fqbn) ?? null;
        if (stillPresent) {
          // Auto-swap: if the current selection is an unidentified port (no
          // FQBN) and an identified board is now available, prefer it. Gated by
          // the personal preference; when off, a present selection is kept.
          if (autoSelectIdentifiedBoard && !current!.fqbn && firstIdentified) {
            return firstIdentified;
          }
          return current!;
        }
        // Selection gone (or none yet): prefer an identified board, else first.
        return firstIdentified ?? detected[0] ?? null;
      });
    } catch (err) {
      setCliError(typeof err === 'string' ? err : String(err));
      // Don't leave stale entries on screen after a failed scan.
      setBoards([]);
      setSelectedBoard(null);
    }
  }, [tauriAvailable, autoSelectIdentifiedBoard]);

  // Shared compile→upload runner: drives uploadStatus/lastResult around any
  // Rust upload command (generated diagram or the bundled test sketch).
  const runUpload = useCallback(
    async (command: string, args: Record<string, unknown>): Promise<UploadResult> => {
      if (!tauriAvailable) {
        throw new Error('Desktop runtime not available — Tauri is required for uploads.');
      }
      // Clear any pending idle-reset from a previous run so it can't clobber
      // this run's status mid-flight (which would re-enable the button).
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      cancelledRef.current = false;
      const scheduleReset = () => {
        resetTimerRef.current = setTimeout(() => {
          setUploadStatus('idle');
          resetTimerRef.current = null;
        }, 3500);
      };

      setUploadStatus('compiling');
      setUploadProgress(null);
      try {
        const rustResult = await invoke<RustUploadResult>(command, args);
        if (cancelledRef.current) {
          const result: UploadResult = {
            success: false,
            compileOutput: '',
            uploadOutput: '',
            errorMessage: 'Cancelled',
          };
          setLastResult(result);
          setUploadStatus('error');
          scheduleReset();
          return result;
        }
        const result: UploadResult = {
          success: rustResult.success,
          compileOutput: rustResult.compile_output,
          uploadOutput: rustResult.upload_output,
          errorMessage: null,
        };
        setLastResult(result);
        setUploadStatus(result.success ? 'success' : 'error');
        scheduleReset();
        return result;
      } catch (err) {
        const message = cancelledRef.current
          ? 'Cancelled'
          : typeof err === 'string'
            ? err
            : String(err);
        // Invoke-level failures have no compile/upload output — surface them as
        // a plain error message instead of a misleading "upload output".
        const result: UploadResult = {
          success: false,
          compileOutput: '',
          uploadOutput: '',
          errorMessage: message,
        };
        setLastResult(result);
        setUploadStatus('error');
        scheduleReset();
        return result;
      }
    },
    [tauriAvailable],
  );

  const compileAndUpload = useCallback(
    (sketchSource: string, fqbn: string, port: string): Promise<UploadResult> =>
      runUpload('compile_and_upload', { sketchSource, fqbn, port }),
    [runUpload],
  );

  // Compiles and uploads the bundled hardware bring-up test sketch (sources
  // embedded in the Rust backend, identical to hardware-test/ in the repo).
  const uploadTestSketch = useCallback(
    (fqbn: string, port: string): Promise<UploadResult> =>
      runUpload('upload_test_sketch', { fqbn, port }),
    [runUpload],
  );

  // Kills the in-flight compile/upload. The in-progress runUpload sees the
  // cancelled flag and reports 'Cancelled'.
  const cancelUpload = useCallback(async () => {
    if (!tauriAvailable) return;
    cancelledRef.current = true;
    try {
      await invoke<void>('cancel_upload');
    } catch {
      // Best-effort — if the process already exited there's nothing to kill.
    }
  }, [tauriAvailable]);

  // Probes (Windows only) for a plugged-in board that Windows sees but has no
  // driver for — the failure mode when a core's post-install driver script
  // never ran. Best-effort: detection errors never surface as their own UI.
  const checkDrivers = useCallback(async () => {
    if (!tauriAvailable) return;
    try {
      const issue = await invoke<DriverIssue | null>('check_driver_issue');
      setDriverIssue(issue);
    } catch {
      // Leave the current value in place — a failed probe is not a signal.
    }
  }, [tauriAvailable]);

  // Runs the board platforms' driver installers elevated (Windows shows a UAC
  // prompt). Re-probes afterwards either way: a successful install makes the
  // board's COM port appear on the next scan.
  const installDrivers = useCallback(async () => {
    if (!tauriAvailable) return;
    setDriverInstallStatus('installing');
    setDriverError(null);
    try {
      await invoke<void>('install_drivers');
      setDriverInstallStatus('idle');
    } catch (err) {
      setDriverInstallStatus('error');
      setDriverError(typeof err === 'string' ? err : String(err));
    }
    await checkDrivers();
    await refreshBoards();
  }, [tauriAvailable, checkDrivers, refreshBoards]);

  const checkCore = useCallback(async () => {
    if (!tauriAvailable) {
      setCoreInstalled(null);
      return;
    }
    setCoreInstallStatus('checking');
    try {
      const installed = await invoke<boolean>('check_avr_core');
      setCoreInstalled(installed);
      setCoreInstallStatus('idle');
      setCoreError(null);
    } catch (err) {
      setCoreInstalled(null);
      setCoreInstallStatus('error');
      setCoreError(typeof err === 'string' ? err : String(err));
    }
  }, [tauriAvailable]);

  const dismissCoreInstall = useCallback(() => {
    setCoreInstallStatus('idle');
  }, []);

  const installCore = useCallback(async () => {
    if (!tauriAvailable) return;
    setCoreInstallStatus('installing');
    setInstallLog('');
    setCoreError(null);

    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<string>('arduino-install-log', (event) => {
        setInstallLog((prev) => prev + event.payload);
      });
      await invoke<void>('install_avr_core');
      // Verify against arduino-cli rather than optimistically trusting success.
      await checkCore();
      setCoreInstallStatus('success');
    } catch (err) {
      setCoreInstallStatus('error');
      setCoreError(typeof err === 'string' ? err : String(err));
    } finally {
      if (unlisten) unlisten();
    }
  }, [tauriAvailable, checkCore]);

  // Check CLI availability on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkCli(); // async probe — setState inside checkCli is inherent to the pattern
  }, [checkCli]);

  // Once the CLI is available, probe the AVR core
  useEffect(() => {
    if (cliAvailable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      checkCore(); // async probe — setState inside checkCore is inherent to the pattern
    }
  }, [cliAvailable, checkCore]);

  // Once the CLI is available, scan for boards automatically (mirrors checkCore).
  useEffect(() => {
    if (cliAvailable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshBoards(); // async probe — setState inside refreshBoards is inherent to the pattern
    }
  }, [cliAvailable, refreshBoards]);

  // Gently poll for plug/unplug while nothing is in flight. Skipped during an
  // upload or install so a rescan can't disturb an active flow.
  useEffect(() => {
    if (!cliAvailable) return;
    const busy =
      uploadStatus === 'compiling' ||
      uploadStatus === 'uploading' ||
      coreInstallStatus === 'installing';
    if (busy) return;
    const id = setInterval(() => {
      refreshBoards();
    }, 5000);
    return () => clearInterval(id);
  }, [cliAvailable, uploadStatus, coreInstallStatus, refreshBoards]);

  // While no board is visible, periodically check whether one is actually
  // plugged in but stuck without a USB driver. The Rust command is a cheap
  // no-op off Windows (always null). A detected board clears the warning.
  useEffect(() => {
    if (!cliAvailable) return;
    if (boards.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDriverIssue(null);
      return;
    }
    checkDrivers();
    const id = setInterval(() => {
      checkDrivers();
    }, 10000);
    return () => clearInterval(id);
  }, [cliAvailable, boards.length, checkDrivers]);

  // Reflect the compile→upload phase transition emitted by the Rust backend.
  useEffect(() => {
    if (!tauriAvailable) return;
    let active = true;
    let unlisten: UnlistenFn | null = null;
    listen<string>('arduino-upload-phase', (event) => {
      if (event.payload === 'uploading') {
        setUploadStatus('uploading');
      }
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [tauriAvailable]);

  // Reflect fine-grained compile/upload progress emitted by the Rust backend.
  useEffect(() => {
    if (!tauriAvailable) return;
    let active = true;
    let unlisten: UnlistenFn | null = null;
    listen<UploadProgress>('arduino-upload-progress', (event) => {
      setUploadProgress(event.payload);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [tauriAvailable]);

  // Clear any pending idle-reset timer on unmount.
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  return {
    tauriAvailable,
    cliAvailable,
    cliVersion,
    cliError,
    boards,
    selectedBoard,
    setSelectedBoard,
    refreshBoards,
    uploadStatus,
    uploadProgress,
    lastResult,
    compileAndUpload,
    uploadTestSketch,
    cancelUpload,
    coreInstalled,
    coreInstallStatus,
    installLog,
    coreError,
    checkCore,
    installCore,
    dismissCoreInstall,
    driverIssue,
    driverInstallStatus,
    driverError,
    installDrivers,
  };
}
