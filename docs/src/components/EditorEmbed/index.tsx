import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';
import './EditorEmbed.css';

export interface EditorEmbedProps {
  /**
   * Named starter diagram to load. See the playground preset registry
   * (src/playground/presets.ts): 'blank' | 'coward' | 'aggressor' | 'love'.
   */
  preset?: string;
  /** Start with trace mode (the live signal simulation) already on. */
  trace?: boolean;
  /** Inline diagram as URL-encoded JSON. Takes precedence over `preset`. */
  diagram?: string;
  /** Iframe height in CSS pixels. Defaults to 520. */
  height?: number;
  /** Accessible title for the iframe. */
  title?: string;
  /** Optional caption shown beneath the editor. */
  caption?: React.ReactNode;
}

function buildQuery({ preset, trace, diagram }: EditorEmbedProps): string {
  const params = new URLSearchParams();
  if (diagram) params.set('diagram', diagram);
  else if (preset) params.set('preset', preset);
  if (trace) params.set('trace', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Embeds the real BraitenBot editor as a browser-only "playground" iframe, so a
 * docs page can invite the reader to drag, wire, and trace directly on the page
 * instead of only reading about it. The iframe content is a standalone build of
 * the app (see vite.playground.config.ts), served from the site's static/
 * folder. Rendered client-side only — the heavy editor never runs during SSR.
 */
export default function EditorEmbed(props: EditorEmbedProps) {
  const { height = 520, title = 'BraitenBot editor', caption } = props;
  const base = useBaseUrl('/playground/playground.html');
  const src = `${base}${buildQuery(props)}`;

  return (
    <figure className="editor-embed">
      <BrowserOnly
        fallback={
          <div className="editor-embed-loading" style={{ height }}>
            Loading the editor…
          </div>
        }
      >
        {() => (
          <iframe
            className="editor-embed-frame"
            src={src}
            title={title}
            style={{ height }}
            loading="lazy"
          />
        )}
      </BrowserOnly>
      {caption && <figcaption className="editor-embed-caption">{caption}</figcaption>}
    </figure>
  );
}
