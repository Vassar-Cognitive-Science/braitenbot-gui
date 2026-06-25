import React, {createElement, useEffect, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useBaseUrlUtils} from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

// Loaded from a CDN at runtime (browser only) so we don't add a build-time
// dependency. Pinned to the 4.x major.
const MODEL_VIEWER_SRC =
  'https://unpkg.com/@google/model-viewer@4/dist/model-viewer.min.js';

function ensureScript(): void {
  if (document.querySelector('script[data-model-viewer]')) {
    return;
  }
  const script = document.createElement('script');
  script.type = 'module';
  script.src = MODEL_VIEWER_SRC;
  script.setAttribute('data-model-viewer', '');
  document.head.appendChild(script);
}

type DownloadLink = {label: string; href: string};

type ModelViewerProps = {
  /** glTF/GLB URL to display (e.g. "/models/00-wheel.glb"). */
  src: string;
  /** Accessible description of the model. */
  alt: string;
  /** Optional still image shown before the model loads. */
  poster?: string;
  /** Optional caption shown beneath the viewer. */
  caption?: ReactNode;
  /** Optional download links (e.g. the source 3MF and the GLB). */
  downloads?: DownloadLink[];
};

// The <model-viewer> custom element touches `window`/`customElements`, so it
// only renders in the browser. The caption and download links render normally
// (SSR + no-JS friendly).
function Viewer({src, alt, poster}: Pick<ModelViewerProps, 'src' | 'alt' | 'poster'>) {
  useEffect(ensureScript, []);
  return createElement('model-viewer', {
    src,
    alt,
    poster,
    'camera-controls': true,
    'auto-rotate': true,
    'touch-action': 'pan-y',
    // Start at a 3/4 view and light it for form rather than flat fill.
    'camera-orbit': '-28deg 72deg auto',
    'tone-mapping': 'commerce',
    exposure: '1.15',
    'shadow-intensity': '1.2',
    'shadow-softness': '0.8',
    loading: 'lazy',
    reveal: 'auto',
    className: styles.viewer,
  });
}

export default function ModelViewer({
  src,
  alt,
  poster,
  caption,
  downloads,
}: ModelViewerProps): ReactNode {
  // Resolve site-relative asset paths against the site's baseUrl (external
  // URLs are passed through untouched).
  const {withBaseUrl} = useBaseUrlUtils();
  return (
    <figure className={styles.figure}>
      <BrowserOnly fallback={<div className={styles.viewer} />}>
        {() => (
          <Viewer
            src={withBaseUrl(src)}
            alt={alt}
            poster={poster ? withBaseUrl(poster) : undefined}
          />
        )}
      </BrowserOnly>
      {(caption || downloads?.length) && (
        <figcaption className={styles.caption}>
          <span>{caption}</span>
          {downloads?.length ? (
            <span className={styles.downloads}>
              {downloads.map((d) => (
                <a key={d.href} href={withBaseUrl(d.href)} download>
                  ↓ {d.label}
                </a>
              ))}
            </span>
          ) : null}
        </figcaption>
      )}
    </figure>
  );
}
