/**
 * Tiny in-module pub/sub that lets the homepage "I'm a student" CTA trigger
 * the install modal, which actually lives (and renders) in `Root`. No React
 * dependency, just a shared `Set` of listeners.
 */

const listeners = new Set<() => void>();

export function openInstallModal(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function onOpenInstallModal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
