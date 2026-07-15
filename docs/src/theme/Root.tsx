import React, { useEffect, type ReactNode } from 'react';
import { suppressNativeContextMenuIfEmbedded } from '@site/src/lib/appBridge';
import InstallModal from '@site/src/components/InstallModal';

/**
 * Root swizzle: Docusaurus renders this component above everything else on
 * every page, so it's the one place to wire up app-wide, page-independent
 * behavior. Two responsibilities live here:
 *
 * 1. Suppressing the native right-click context menu when the site is
 *    loaded inside the desktop app's Lessons iframe (see
 *    `src/lib/appBridge.ts` for why) — SPA navigation between docs pages
 *    never remounts this component, so the effect only needs to run once.
 * 2. Rendering `InstallModal`, the first-visit "get the app" interstitial.
 *    It manages its own visibility (including staying hidden when embedded
 *    in the app) and portals itself to `document.body`, so mounting it here
 *    unconditionally is enough to have it available on every page.
 */
export default function Root({ children }: { children: ReactNode }): React.ReactElement {
  useEffect(() => suppressNativeContextMenuIfEmbedded(), []);
  return (
    <>
      {children}
      <InstallModal />
    </>
  );
}
