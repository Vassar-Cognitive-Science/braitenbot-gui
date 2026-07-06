import { useEffect, useRef } from 'react';
import type { ValidationError } from '../codegen';
import type { UploadResult } from '../hooks/useArduino';

/**
 * Drive a native <dialog>'s modal state from a React `open` boolean, opening
 * with showModal() and closing with close() as it changes.
 */
function useDialogOpen(open: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return ref;
}

interface CodeDialogProps {
  open: boolean;
  onClose: () => void;
  errors: ValidationError[];
  generatedCode: string | null;
  onCopy: () => void;
  onDownload: () => void;
  serialDebug: boolean;
  onSerialDebugChange: (value: boolean) => void;
}

export function CodeDialog({ open, onClose, errors, generatedCode, onCopy, onDownload, serialDebug, onSerialDebugChange }: CodeDialogProps) {
  const dialogRef = useDialogOpen(open);
  return (
    <dialog
      ref={dialogRef}
      className="code-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="code-dialog-inner">
        <div className="code-dialog-header">
          <h2>Generated Arduino Code</h2>
          <button type="button" className="config-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {errors.length > 0 && (
          <ul className="code-errors">
            {errors.map((err, i) => (
              <li key={i} className={`code-error-${err.severity}`}>
                {err.message}
              </li>
            ))}
          </ul>
        )}

        {generatedCode && (
          <>
            <pre className="code-preview"><code>{generatedCode}</code></pre>
            <div className="code-dialog-actions">
              <button onClick={onCopy}>Copy to Clipboard</button>
              <button onClick={onDownload}>Download .ino</button>
              <label className="code-dialog-debug-label">
                <input
                  type="checkbox"
                  checked={serialDebug}
                  onChange={(e) => onSerialDebugChange(e.target.checked)}
                />
                Serial debug prints
              </label>
            </div>
          </>
        )}

        {!generatedCode && errors.some((e) => e.severity === 'error') && (
          <p className="code-error-hint">Fix the errors above before generating code.</p>
        )}
      </div>
    </dialog>
  );
}

interface UploadErrorDialogProps {
  open: boolean;
  onClose: () => void;
  result: UploadResult | null;
}

export function UploadErrorDialog({ open, onClose, result }: UploadErrorDialogProps) {
  const dialogRef = useDialogOpen(open);
  return (
    <dialog
      ref={dialogRef}
      className="code-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="code-dialog-inner">
        <div className="code-dialog-header">
          <h2>Upload failed</h2>
          <button
            type="button"
            className="config-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {result?.errorMessage && (
          <p className="upload-error-message">{result.errorMessage}</p>
        )}
        {result?.compileOutput && (
          <>
            <h3 className="upload-error-section">Compile output</h3>
            <pre className="code-preview"><code>{result.compileOutput}</code></pre>
          </>
        )}
        {result?.uploadOutput && (
          <>
            <h3 className="upload-error-section">Upload output</h3>
            <pre className="code-preview"><code>{result.uploadOutput}</code></pre>
          </>
        )}
        {!result?.errorMessage &&
          !result?.compileOutput &&
          !result?.uploadOutput && <p>No output captured.</p>}
      </div>
    </dialog>
  );
}
