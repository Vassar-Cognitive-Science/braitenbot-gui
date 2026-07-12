import type { useArduino, UploadResult } from '../hooks/useArduino';

/**
 * Browser-safe stand-in for {@link useArduino}, used by the docs playground.
 *
 * The playground runs the real editor in a plain browser (no Tauri), so there
 * is no arduino-cli and no serial port. `BraitenbergDiagram` in `mode="playground"`
 * hides every control that would touch these values, but the prop is still
 * required, so this supplies an inert object of the exact same shape. Typing the
 * return as `ReturnType<typeof useArduino>` keeps it honest: if the hook grows a
 * field, this stub stops compiling until it's updated.
 */
const DISABLED_RESULT: UploadResult = {
  success: false,
  compileOutput: '',
  uploadOutput: '',
  errorMessage: 'Uploads are disabled in the docs playground.',
};

export function stubArduino(): ReturnType<typeof useArduino> {
  return {
    tauriAvailable: false,
    cliAvailable: false,
    cliVersion: null,
    cliError: null,
    boards: [],
    selectedBoard: null,
    setSelectedBoard: () => {},
    refreshBoards: async () => {},
    uploadStatus: 'idle',
    uploadProgress: null,
    lastResult: null,
    compileAndUpload: async () => DISABLED_RESULT,
    uploadTestSketch: async () => DISABLED_RESULT,
    cancelUpload: async () => {},
    coreInstalled: null,
    coreInstallStatus: 'idle',
    installLog: '',
    coreError: null,
    checkCore: async () => {},
    installCore: async () => {},
    dismissCoreInstall: () => {},
    driverIssue: null,
    driverInstallStatus: 'idle',
    driverError: null,
    installDrivers: async () => {},
  };
}
