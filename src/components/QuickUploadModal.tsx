import { useMemo, useState } from 'react';
import type { useArduino } from '../hooks/useArduino';
import { prepareQuickUpload } from '../lib/quickUpload';

type ArduinoState = ReturnType<typeof useArduino>;

interface QuickUploadModalProps {
  /** Serialized DiagramState posted by a lesson's "Upload to bot" button. */
  file: string;
  onClose: () => void;
  /** The app-level arduino state (board detection/polling, upload flow) —
   *  shared with the editor, never duplicated. */
  arduino: ArduinoState;
}

/**
 * Lightweight "Upload to bot" dialog for lesson circuits: pick a board and
 * flash the lesson's current wiring directly, without opening the editor.
 *
 * Rendered as a fixed overlay *below* SetupModal (z-index 900 vs 1000, and
 * before it in App's JSX): on a fresh install with no Arduino cores, the
 * one-time SetupModal overlays this dialog until setup finishes, then reveals
 * it — the quick upload simply waits behind the setup gate.
 */
export function QuickUploadModal({ file, onClose, arduino }: QuickUploadModalProps) {
  const {
    tauriAvailable,
    cliAvailable,
    boards,
    selectedBoard,
    setSelectedBoard,
    uploadStatus,
    uploadProgress,
    lastResult,
    compileAndUpload,
    cancelUpload,
  } = arduino;

  const prep = useMemo(() => prepareQuickUpload(file), [file]);

  // uploadStatus/lastResult are app-shared (the editor writes them too), so
  // only surface them here once THIS dialog has started an upload — otherwise
  // a stale editor result would flash "Uploaded!" on open.
  const [attempted, setAttempted] = useState(false);

  const busy = uploadStatus === 'compiling' || uploadStatus === 'uploading';
  const boardReady = !!selectedBoard && !!selectedBoard.fqbn;
  const canUpload = prep.kind === 'ready' && tauriAvailable && cliAvailable && boardReady && !busy;

  const handleUpload = () => {
    if (prep.kind !== 'ready' || !selectedBoard?.fqbn) return;
    setAttempted(true);
    void compileAndUpload(prep.code, selectedBoard.fqbn, selectedBoard.port);
  };

  const handleClose = () => {
    if (busy && attempted) void cancelUpload();
    onClose();
  };

  const uploadPercent =
    uploadProgress &&
    ((uploadStatus === 'compiling' && uploadProgress.phase === 'compile') ||
      (uploadStatus === 'uploading' && uploadProgress.phase === 'upload'))
      ? uploadProgress.percent
      : null;

  const uploadHint = !tauriAvailable
    ? 'Uploading needs the desktop app.'
    : boards.length === 0
      ? 'Plug in your robot over USB to enable uploading.'
      : !boardReady
        ? 'The selected port is not recognized as an Arduino.'
        : undefined;

  return (
    <div
      className="quick-upload-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-upload-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="quick-upload-modal">
        <div className="quick-upload-header">
          <h2 id="quick-upload-title">Upload to your robot</h2>
          <button type="button" className="config-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {prep.kind === 'parse-error' && (
          <>
            <p>This lesson circuit couldn&apos;t be read — try reloading the lesson page.</p>
            <p className="quick-upload-detail">{prep.message}</p>
          </>
        )}

        {prep.kind === 'invalid' && (
          <>
            <p>This circuit isn&apos;t ready to upload yet:</p>
            <ul className="quick-upload-errors">
              {prep.errors.map((error, i) => (
                <li key={i}>{error.message}</li>
              ))}
            </ul>
          </>
        )}

        {prep.kind === 'ready' && (
          <>
            <p>
              Flash this lesson&apos;s circuit onto your robot. Your work in the editor is not
              affected.
            </p>

            <div className="quick-upload-board">
              <span className="quick-upload-board-label">Board</span>
              {boards.length === 0 ? (
                <span className="quick-upload-hint">
                  {tauriAvailable
                    ? 'No board detected — plug your robot in over USB. It will appear here automatically.'
                    : 'Uploading needs the desktop app.'}
                </span>
              ) : (
                <select
                  className="quick-upload-board-select"
                  value={selectedBoard?.port ?? ''}
                  disabled={busy}
                  onChange={(e) => {
                    const board = boards.find((b) => b.port === e.target.value);
                    if (board) setSelectedBoard(board);
                  }}
                >
                  {boards.map((board) => (
                    <option key={board.port} value={board.port}>
                      {board.name ?? 'Unidentified device'} — {board.port}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {attempted && busy && (
              <div className="quick-upload-status" role="status" aria-live="polite">
                <span className="upload-progress-label">
                  {uploadStatus === 'compiling' ? 'Compiling' : 'Uploading'}
                  {uploadPercent != null ? ` ${Math.round(uploadPercent)}%` : '…'}
                </span>
                {uploadPercent != null ? (
                  <progress className="upload-progress-bar" max={100} value={uploadPercent} />
                ) : (
                  <div className="upload-progress-bar is-indeterminate">
                    <div className="upload-progress-fill" />
                  </div>
                )}
              </div>
            )}

            {attempted && uploadStatus === 'success' && (
              <p className="quick-upload-success">
                Uploaded! Your robot is now running this circuit.
              </p>
            )}

            {attempted && uploadStatus === 'error' && (
              <div className="quick-upload-error">
                <p>{lastResult?.errorMessage ?? 'Upload failed.'}</p>
                {lastResult && (lastResult.compileOutput || lastResult.uploadOutput) && (
                  <details className="quick-upload-error-details">
                    <summary>Details</summary>
                    <pre className="setup-log">
                      {[lastResult.compileOutput, lastResult.uploadOutput]
                        .filter(Boolean)
                        .join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="quick-upload-actions">
              {busy && attempted ? (
                <button type="button" className="quick-upload-cancel" onClick={() => void cancelUpload()}>
                  Cancel upload
                </button>
              ) : (
                <button
                  type="button"
                  className="quick-upload-primary"
                  onClick={handleUpload}
                  disabled={!canUpload}
                  title={uploadHint}
                >
                  {attempted && uploadStatus === 'success' ? 'Upload again' : 'Upload'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
