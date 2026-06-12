import { useEffect, useRef, useState } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Round committed values to whole numbers (parallel to parseInt semantics). */
  integer?: boolean;
}

/**
 * Controlled number input that tolerates transient invalid text while typing.
 *
 * A naive controlled input coerces every keystroke through parse/clamp, so
 * clearing the field instantly snaps back to a default and the user can never
 * type a replacement value. Instead this keeps the raw text in local state:
 * valid values are clamped and committed on each keystroke, while invalid
 * text (empty, "-", "1e") stays in the field until blur, which reverts the
 * display to the last committed value without ever committing a default.
 */
export function NumberInput({ value, onChange, min, max, step, integer }: NumberInputProps) {
  const [text, setText] = useState(() => value.toString());
  const lastCommitted = useRef(value);

  // Sync the field when the value changes from outside (e.g. selecting a
  // different node, or a linked slider moving).
  useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(value.toString());
      lastCommitted.current = value;
    }
  }, [value]);

  const clamp = (n: number): number => {
    let v = integer ? Math.round(n) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number.parseFloat(next);
        if (Number.isFinite(parsed)) {
          const clamped = clamp(parsed);
          lastCommitted.current = clamped;
          onChange(clamped);
        }
      }}
      onBlur={() => {
        const parsed = Number.parseFloat(text);
        // Invalid or out-of-range text: restore the committed value's display.
        if (!Number.isFinite(parsed) || clamp(parsed) !== parsed) {
          setText(lastCommitted.current.toString());
        }
      }}
    />
  );
}
