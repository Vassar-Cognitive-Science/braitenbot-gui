// No-op stand-in for `virtual:pwa-register` used when building for Tauri,
// where the vite-plugin-pwa plugin is disabled and the virtual module does
// not exist. Keeps main.tsx's import resolvable without runtime effects.
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
