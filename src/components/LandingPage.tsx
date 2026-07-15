import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { isTauri } from '../lib/tauri';
import { openExternal } from '../lib/externalLink';
import { getRecents, type RecentFile } from '../lib/recentFiles';
import { BookIcon, FlagIcon, GithubIcon } from './icons';

const GITHUB_URL = 'https://github.com/Vassar-Cognitive-Science/braitenbot-gui';
const DOCS_URL = 'https://vassar-cognitive-science.github.io/braitenbot-gui/';
const ISSUE_URL = 'https://github.com/Vassar-Cognitive-Science/braitenbot-gui/issues/new';

const LAMP = '#e0a852'; // illustrative stimulus light — warm amber
const TRAJECTORY = 'M 58 314 C 150 316, 214 300, 258 258 S 330 150, 360 102';

/**
 * The docs homepage's hand-inked phototaxis scene (docs/src/pages/index.tsx),
 * recolored for the app's dark theme: a Vehicle 3a drives the plotted
 * trajectory toward a lamp, linework wobbled by an SVG displacement filter so
 * it reads as pen-and-ink rather than clean vector.
 */
function PhototaxisScene() {
  return (
    <svg
      className="landing-scene"
      viewBox="0 0 480 360"
      role="img"
      aria-label="Hand-drawn illustration of a Braitenberg vehicle steering along a curved path toward a light source."
    >
      <defs>
        <filter id="landing-ink" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="landing-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* lamp glow sits behind everything, unfiltered so the blur stays soft */}
      <circle className="landing-lamp-glow" cx="372" cy="84" r="26" fill={LAMP} filter="url(#landing-glow)" />

      {/* hand-inked scene */}
      <g filter="url(#landing-ink)">
        {/* the plotted trajectory — emergent behavior, drawn in signal-green */}
        <path className="landing-trajectory" d={TRAJECTORY} />
        <circle className="landing-start-dot" cx="58" cy="314" r="3.5" />

        {/* the light source, hand-drawn */}
        <g>
          <circle cx="372" cy="84" r="9" fill={LAMP} className="landing-lamp-bulb" />
          <g className="landing-lamp-rays">
            <line x1="372" y1="60" x2="372" y2="68" />
            <line x1="351" y1="65" x2="356" y2="72" />
            <line x1="393" y1="65" x2="388" y2="72" />
            <line x1="349" y1="84" x2="357" y2="84" />
            <line x1="395" y1="84" x2="387" y2="84" />
          </g>
        </g>
      </g>

      {/* the vehicle drives the path, banking into the curve */}
      <g className="landing-vehicle">
        <g filter="url(#landing-ink)">
          <rect className="landing-v-body" x="-15" y="-9" width="30" height="18" rx="7" />
          <rect className="landing-v-wheel" x="-8" y="-14" width="13" height="5" rx="2" />
          <rect className="landing-v-wheel" x="-8" y="9" width="13" height="5" rx="2" />
          <line className="landing-v-stalk" x1="13" y1="-5" x2="19" y2="-7" />
          <line className="landing-v-stalk" x1="13" y1="5" x2="19" y2="7" />
          <circle className="landing-v-sensor" cx="20" cy="-7" r="2.8" />
          <circle className="landing-v-sensor" cx="20" cy="7" r="2.8" />
        </g>
      </g>

      {/* a margin note, as if penned by a reader */}
      <text className="landing-note" x="450" y="336" textAnchor="end">it steers toward the light</text>
      <path className="landing-note-arrow" d="M 300 322 C 282 314, 268 296, 262 272" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="landing-cta-arrow" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Hand-rolled relative time, coarse on purpose ("2 days ago"). */
function formatRelativeTime(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes <= 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours <= 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks <= 1 ? '1 week ago' : `${weeks} weeks ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Recently saved/opened diagram files, verified to still exist on disk.
 * Tauri-only: the caller hides this entirely in plain-browser dev. Clicks go
 * through the Tauri event bus (`app://open-path` / `menu://load`), where the
 * always-mounted editor's persistence hook picks them up and switches the
 * view via onDiagramOpened.
 */
function RecentDesigns() {
  // null = still checking the filesystem; render nothing until resolved so
  // entries that no longer exist never flash.
  const [recents, setRecents] = useState<RecentFile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = getRecents();
        if (stored.length === 0) {
          if (!cancelled) setRecents([]);
          return;
        }
        const exists = await invoke<boolean[]>('paths_exist', {
          paths: stored.map((entry) => entry.path),
        });
        if (!cancelled) setRecents(stored.filter((_, i) => exists[i] === true));
      } catch {
        if (!cancelled) setRecents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="landing-recents">
      <header className="landing-recents-head">
        <span className="landing-recents-label">Recent designs</span>
        <button
          type="button"
          className="landing-open-file"
          onClick={() => void emit('menu://load')}
        >
          Open a file… <Arrow />
        </button>
      </header>
      {recents !== null && recents.length === 0 && (
        <p className="landing-recents-empty">Designs you save will appear here.</p>
      )}
      {recents !== null && recents.length > 0 && (
        <ul className="landing-recents-list">
          {recents.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="landing-recent"
                onClick={() => void emit('app://open-path', { path: entry.path })}
                title={entry.path}
              >
                <span className="landing-recent-name">{entry.name}</span>
                <span className="landing-recent-time">{formatRelativeTime(entry.openedAt)}</span>
                <span className="landing-recent-path">{entry.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface LandingPageProps {
  onEnterEditor: () => void;
  onEnterLessons: () => void;
}

export function LandingPage({ onEnterEditor, onEnterLessons }: LandingPageProps) {
  // Best-effort: only meaningful inside the desktop app, and never worth
  // blocking the landing screen on.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        // Best-effort — leave the version out of the footer.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openLink = (url: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    void openExternal(url);
  };

  return (
    <div className="landing-screen">
      <div className="landing-main">
        <div className="landing-hero">
          <div className="landing-hero-text">
            <p className="landing-eyebrow landing-rise">Synthetic Psychology</p>
            <h1 className="landing-title landing-rise" style={{ animationDelay: '0.05s' }}>
              BraitenBot
            </h1>
            <p className="landing-tagline landing-rise" style={{ animationDelay: '0.1s' }}>
              Design Braitenberg vehicles. Study how behavior emerges.
            </p>
            <div className="landing-actions landing-rise" style={{ animationDelay: '0.15s' }}>
              <button type="button" className="landing-cta landing-cta-primary" onClick={onEnterEditor}>
                <span className="landing-cta-title">
                  Editor <Arrow />
                </span>
                <span className="landing-cta-desc">Build and upload wiring diagrams to your robot.</span>
              </button>
              <button type="button" className="landing-cta landing-cta-ghost" onClick={onEnterLessons}>
                <span className="landing-cta-title">
                  Lessons <Arrow />
                </span>
                <span className="landing-cta-desc">Hands-on tutorials — no robot required.</span>
              </button>
            </div>
          </div>

          <figure className="landing-figure landing-rise" style={{ animationDelay: '0.2s' }}>
            <PhototaxisScene />
            <figcaption className="landing-figcaption">
              <span><strong>Fig. 3a</strong> · Phototaxis</span>
            </figcaption>
          </figure>
        </div>

        {isTauri() && (
          <div className="landing-rise" style={{ animationDelay: '0.25s' }}>
            <RecentDesigns />
          </div>
        )}
      </div>

      <div className="landing-footer landing-rise" style={{ animationDelay: '0.3s' }}>
        <a className="landing-footer-link" href={GITHUB_URL} onClick={openLink(GITHUB_URL)}>
          <GithubIcon size={13} />
          <span>GitHub</span>
        </a>
        <a className="landing-footer-link" href={DOCS_URL} onClick={openLink(DOCS_URL)}>
          <BookIcon size={13} />
          <span>Documentation</span>
        </a>
        <a className="landing-footer-link" href={ISSUE_URL} onClick={openLink(ISSUE_URL)}>
          <FlagIcon size={13} />
          <span>Report an issue</span>
        </a>
        {version && <span className="landing-version">v{version}</span>}
      </div>
    </div>
  );
}
