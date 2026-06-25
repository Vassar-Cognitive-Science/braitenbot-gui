import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useThemeConfig} from '@docusaurus/theme-common';
import type {Footer as FooterConfig} from '@docusaurus/theme-common';

import styles from './styles.module.css';

type LinkItem = {label?: string; to?: string; href?: string};
type LinkColumn = {title?: string; items: LinkItem[]};

/**
 * The colophon — the dark "ink page" at the back of the monograph.
 *
 * Where the rest of the site is warm graph-paper, the footer is the inside
 * back cover: ink ground, hairline rules, a Fraunces wordmark, and link
 * columns headed like figure labels. A small hand-inked vehicle drives off
 * the edge of the page, echoing the hero plate.
 */
function ColophonMark(): React.ReactElement {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 64 40"
      role="img"
      aria-label="Hand-drawn Braitenberg vehicle, the site's colophon mark."
    >
      <defs>
        <filter id="bb-footer-ink" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter="url(#bb-footer-ink)">
        <line className={styles.markTrail} x1="2" y1="30" x2="30" y2="24" />
        <g transform="translate(40 20)">
          <rect className={styles.markBody} x="-13" y="-8" width="26" height="16" rx="6" />
          <rect className={styles.markWheel} x="-7" y="-12" width="11" height="4" rx="2" />
          <rect className={styles.markWheel} x="-7" y="8" width="11" height="4" rx="2" />
          <line className={styles.markStalk} x1="11" y1="-4" x2="17" y2="-6" />
          <line className={styles.markStalk} x1="11" y1="4" x2="17" y2="6" />
          <circle className={styles.markSensor} cx="18" cy="-6" r="2.4" />
          <circle className={styles.markSensor} cx="18" cy="6" r="2.4" />
        </g>
      </g>
    </svg>
  );
}

export default function Footer(): React.ReactElement | null {
  const {footer} = useThemeConfig() as {footer?: FooterConfig};
  const {siteConfig} = useDocusaurusContext();

  if (!footer) {
    return null;
  }

  const columns = (footer.links ?? []) as LinkColumn[];
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <p className={styles.label}>Colophon</p>
            <div className={styles.wordmarkRow}>
              <span className={styles.wordmark}>{siteConfig.title}</span>
              <ColophonMark />
            </div>
            <p className={styles.tagline}>{siteConfig.tagline}</p>
            <p className={styles.meta}>Open source · macOS · Windows · Linux</p>
          </div>

          <nav className={styles.columns} aria-label="Footer">
            {columns.map((col, i) => (
              <div className={styles.column} key={i}>
                {col.title ? <p className={styles.columnTitle}>{col.title}</p> : null}
                <ul className={styles.items}>
                  {col.items.map((item, j) => (
                    <li className={styles.item} key={j}>
                      <Link
                        className={styles.link}
                        to={item.to}
                        href={item.href}
                        {...(item.href
                          ? {target: '_blank', rel: 'noopener noreferrer'}
                          : {})}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.bottom}>
          <span className={styles.copyright}>
            © {year} {siteConfig.title} · Vassar Cognitive Science
          </span>
          <span className={styles.colophonNote}>
            Set in Fraunces &amp; Hanken Grotesk · Built with Docusaurus
          </span>
        </div>
      </div>
    </footer>
  );
}
