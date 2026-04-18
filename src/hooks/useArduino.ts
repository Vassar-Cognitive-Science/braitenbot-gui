import { useCallback, useEffect, useState } from 'react';
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
      // Auto-select the first board with a known FQBN if none chosen yet
      setSelectedBoard((current) => {
        if (current && detected.some((b) => b.port === current.port)) {
          return current;
        }
        return detected.find((b) => b.fqbn) ?? detected[0] ?? null;
      });
    } catch (err) {
      setCliError(typeof err === 'string' ? err : String(err));
    }
  }, [tauriAvailable]);

  const compileAndUpload = useCallback(
    async (sketchSource: string, fqbn: string, port: string): Promise<UploadResult> => {
      if (!tauriAvailable) {
        throw new Error('Desktop runtime not available — Tauri is required for uploads.');
      }
      setUploadStatus('compiling');
      try {
        const rustResult = await invoke<RustUploadResult>('compile_and_upload', {
          sketchSource,
          fqbn,
          port,
        });
        const result: UploadResult = {
          success: rustResult.success,
          compileOutput: rustResult.compile_output,
          uploadOutput: rustResult.upload_output,
        };
        setLastResult(result);
        setUploadStatus(result.success ? 'success' : 'error');
        setTimeout(() => setUploadStatus('idle'), 3500);
        return result;
      } catch (err) {
        const message = typeof err === 'string' ? err : String(err);
        const result: UploadResult = {
          success: false,
          compileOutput: '',
          uploadOutput: message,
        };
        setLastResult(result);
        setUploadStatus('error');
        setTimeout(() => setUploadStatus('idle'), 3500);
        return result;
      }
    },
    [tauriAvailable],
  );

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
      setCoreInstalled(true);
      setCoreInstallStatus('success');
    } catch (err) {
      setCoreInstallStatus('error');
      setCoreError(typeof err === 'string' ? err : String(err));
    } finally {
      if (unlisten) unlisten();
    }
  }, [tauriAvailable]);

  // Check CLI availability on mount
  useEffect(() => {
    checkCli();
  }, [checkCli]);

  // Once the CLI is available, probe the AVR core
  useEffect(() => {
    if (cliAvailable) {
      checkCore();
    }
  }, [cliAvailable, checkCore]);

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
    coreInstalled,
    coreInstallStatus,
    installLog,
    coreError,
    checkCore,
    installCore,
    dismissCoreInstall,
  };
}
