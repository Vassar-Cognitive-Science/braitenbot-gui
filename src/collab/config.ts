import pkg from '../../package.json';

/**
 * Relay endpoint. Configurable at build time via VITE_RELAY_URL (set it to
 * ws://localhost:1234 to develop against `npm run relay:dev`); defaults to the
 * deployed relay behind Apache on cogsciresearch.
 */
export const DEFAULT_RELAY_URL: string =
  (import.meta.env?.VITE_RELAY_URL as string | undefined) ??
  'wss://cogsciresearch.vassar.edu/braitenbot-relay';

/**
 * Resolve the relay endpoint to actually connect to. A non-empty personal
 * override (Settings → Advanced) wins; otherwise fall back to the built-in
 * default. Trimmed so stray whitespace never becomes a bad URL.
 */
export function resolveRelayUrl(override: string | undefined): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_RELAY_URL;
}

/** App version sent in the session handshake (guests must match the host). */
export const APP_VERSION: string = pkg.version;
