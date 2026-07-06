// Persisted choice for the toolbar split button's primary segment. The user
// picks whether clicking the main button uploads to the robot or just shows
// the generated code; that choice sticks across sessions (Gmail "Send |
// Schedule send" pattern).

export type PrimaryAction = 'upload' | 'generate';

export const PRIMARY_ACTION_STORAGE_KEY = 'braitenbot-gui:primary-action:v1';

export const DEFAULT_PRIMARY_ACTION: PrimaryAction = 'upload';

export function isPrimaryAction(value: unknown): value is PrimaryAction {
  return value === 'upload' || value === 'generate';
}

export function loadPrimaryAction(): PrimaryAction {
  try {
    const raw = localStorage.getItem(PRIMARY_ACTION_STORAGE_KEY);
    if (isPrimaryAction(raw)) return raw;
  } catch {
    /* ignore storage errors */
  }
  return DEFAULT_PRIMARY_ACTION;
}

export function savePrimaryAction(action: PrimaryAction): void {
  try {
    localStorage.setItem(PRIMARY_ACTION_STORAGE_KEY, action);
  } catch {
    /* ignore storage errors */
  }
}
