import { useEffect, useState, type ReactNode } from 'react';
import Link from '@docusaurus/Link';
import { isEmbeddedInApp, requestOpenEditor } from '@site/src/lib/appBridge';
import styles from './styles.module.css';

/**
 * Lesson 8's "now open the editor" moment (`docs/docs/on-the-robot/
 * first-upload.mdx`). Inside the desktop app's Lessons iframe, this is a
 * prominent call-to-action that unlocks and switches to the Editor view (see
 * `requestOpenEditor` / the app shell's `braitenbot:open-editor` listener in
 * `src/App.tsx`). On the public website there is no app shell to switch
 * to, so a short static note points browser-only readers at the desktop app
 * instead — the lesson still has to read coherently there.
 *
 * SSR-safe: `isEmbeddedInApp` is only meaningful in a real browser (it reads
 * `sessionStorage`/the query string), so which branch renders is decided in
 * a mount effect rather than during the render Docusaurus performs at build
 * time. SSR and the first client render both render nothing, so flipping
 * `ready` afterward client-side cannot cause a hydration mismatch.
 */
export default function OpenEditorButton(): ReactNode {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return null;
  }

  if (isEmbeddedInApp) {
    return (
      <div className={styles.wrap}>
        <button
          type="button"
          className="button button--primary button--lg"
          onClick={requestOpenEditor}
        >
          Open the Editor
        </button>
      </div>
    );
  }

  return (
    <div className={styles.note}>
      <p>
        This part happens in the desktop app — see the{' '}
        <Link to="/install">Install page</Link>. On an iPad? Pair with a classmate on a
        laptop.
      </p>
    </div>
  );
}
