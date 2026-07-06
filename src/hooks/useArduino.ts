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

export type CoreInstallStatus = 'idle' | 'checking' | 'installing' | 'success' | 'error';

/**
 * Hook for driving arduino-cli through the Tauri backend. Handles board
 * detection and the compile-then-upload flow.
 */
export function useArduino() {
  const tauriAvailable = isTauri();
  const [cliAvailable, setCliAvailable] = useState<boolean>(false);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<BoardInfo | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const [coreInstalled, setCoreInstalled] = useState<boolean | null>(null);
  const [coreInstallStatus, setCoreInstallStatus] = useState<CoreInstallStatus>('idle');
  const [installLog, setInstallLog] = useState<string>('');
  const [coreError, setCoreError] = useState<string | null>(null);

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
      // Keep the user's selection if its port is still present; otherwise
      // auto-select the first board with a known FQBN.
      setSelectedBoard((current) => {
        if (current && detected.some((b) => b.port === current.port)) {
          return current;
        }
        return detected.find((b) => b.fqbn) ?? detected[0] ?? null;
      });
    } catch (err) {
      setCliError(typeof err === 'string' ? err : String(err));
      // Don't leave stale entries on screen after a failed scan.
      setBoards([]);
      setSelectedBoard(null);
    }
  }, [tauriAvailable]);

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
  };
}
