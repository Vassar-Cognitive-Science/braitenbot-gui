import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const LAMP = 'oklch(76% 0.15 74)'; // illustrative stimulus light — warm amber
const TRAJECTORY = 'M 58 314 C 150 316, 214 300, 258 258 S 330 150, 360 102';

/**
 * A page from the book, come to life: a hand-inked Vehicle 3a steering toward a
 * light (phototaxis). The little buggy drives the plotted trajectory, banking
 * into the curve, while the path's signal dots flow toward the source and the
 * lamp breathes. Linework is wobbled by an SVG displacement filter so it reads
 * as pen-and-ink rather than clean vector.
 */
function PhototaxisScene(): React.ReactElement {
  return (
    <svg
      className={styles.scene}
      viewBox="0 0 480 360"
      role="img"
      aria-label="Hand-drawn illustration of a Braitenberg vehicle steering along a curved path toward a light source."
    >
      <defs>
        <filter id="bb-ink" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="bb-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* lamp glow sits behind everything, unfiltered so the blur stays soft */}
      <circle className={styles.lampGlow} cx="372" cy="84" r="26" fill={LAMP} filter="url(#bb-glow)" />

      {/* hand-inked scene */}
      <g filter="url(#bb-ink)">
        {/* the plotted trajectory — emergent behavior, drawn in signal-green */}
        <path className={styles.trajectory} d={TRAJECTORY} />
        <circle className={styles.startDot} cx="58" cy="314" r="3.5" />

        {/* the light source, hand-drawn */}
        <g className={styles.lampInk}>
          <circle cx="372" cy="84" r="9" fill={LAMP} stroke="var(--bb-ink)" strokeWidth="1.4" />
          <g className={styles.rays}>
            <line x1="372" y1="60" x2="372" y2="68" />
            <line x1="351" y1="65" x2="356" y2="72" />
            <line x1="393" y1="65" x2="388" y2="72" />
            <line x1="349" y1="84" x2="357" y2="84" />
            <line x1="395" y1="84" x2="387" y2="84" />
          </g>
        </g>
      </g>

      {/* the vehicle drives the path, banking into the curve */}
      <g className={styles.vehicle}>
        <g filter="url(#bb-ink)">
          <rect className={styles.vBody} x="-15" y="-9" width="30" height="18" rx="7" />
          <rect className={styles.vWheel} x="-8" y="-14" width="13" height="5" rx="2" />
          <rect className={styles.vWheel} x="-8" y="9" width="13" height="5" rx="2" />
          <line className={styles.vStalk} x1="13" y1="-5" x2="19" y2="-7" />
          <line className={styles.vStalk} x1="13" y1="5" x2="19" y2="7" />
          <circle className={styles.vSensor} cx="20" cy="-7" r="2.8" />
          <circle className={styles.vSensor} cx="20" cy="7" r="2.8" />
        </g>
      </g>

      {/* a margin note, as if scribbled by a reader */}
      <text className={styles.note} x="450" y="336" textAnchor="end">it steers toward the light</text>
      <path className={styles.noteArrow} d="M 300 322 C 282 314, 268 296, 262 272" />
    </svg>
  );
}

function Arrow(): React.ReactElement {
  return (
    <svg className={styles.ctaArrow} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="An educational tool for sensorimotor robotics: design Braitenberg vehicles, study how behavior emerges from simple wiring, and run them on Arduino hardware.">
      <main className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroText}>
            <p className={`bb-fig-label ${styles.eyebrow} ${styles.rise}`}>Synthetic Psychology</p>
            <h1 className={`${styles.title} ${styles.rise}`} style={{ animationDelay: '0.05s' }}>
              {siteConfig.title}
            </h1>
            <p className={`${styles.tagline} ${styles.rise}`} style={{ animationDelay: '0.1s' }}>
              {siteConfig.tagline}
            </p>
            <p className={`${styles.lede} ${styles.rise}`} style={{ animationDelay: '0.15s' }}>
              BraitenBot is an educational tool for sensorimotor robotics. Connect sensors to
              motors through weighted links, trace how those signals become behavior, and run
              your design on real Arduino hardware — the thought experiments from Braitenberg’s{' '}
              <em>Vehicles</em>, made tangible.
            </p>
            <div className={`${styles.actions} ${styles.rise}`} style={{ animationDelay: '0.2s' }}>
              <Link className={styles.ctaPrimary} to="/install">
                Download BraitenBot <Arrow />
              </Link>
              <Link className={styles.ctaGhost} to="/docs">
                Read the documentation <Arrow />
              </Link>
            </div>
            <p className={`${styles.meta} ${styles.rise}`} style={{ animationDelay: '0.25s' }}>
              Open source · macOS · Windows · Linux
            </p>
          </div>

          <figure className={`${styles.figure} ${styles.rise}`} style={{ animationDelay: '0.15s' }}>
            <PhototaxisScene />
            <figcaption className={styles.figcaption}>
              <span><strong>Fig. 3a</strong> — Phototaxis</span>
            </figcaption>
          </figure>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className="bb-fig-label">Fig. 4 · The platform</p>
            <h2>An open robotics platform you build yourself.</h2>
            <p className={styles.sectionLede}>
              BraitenBot isn’t a sealed kit. The robot is built from standard, orderable
              parts and a 3D-printed chassis, and every layer — the editor, the firmware it
              generates, and the hardware itself — is open and meant to be modified.
            </p>
          </div>

          <dl className={styles.specs}>
            <div className={styles.spec}>
              <dt className={styles.specTerm}>Orderable parts</dt>
              <dd className={styles.specDesc}>
                An Arduino-compatible board, two continuous-rotation servos for the
                wheels, and light, distance, and color sensors — stock components from
                any electronics supplier, not a proprietary kit.
              </dd>
            </div>
            <div className={styles.spec}>
              <dt className={styles.specTerm}>3D-printed chassis</dt>
              <dd className={styles.specDesc}>
                The chassis, wheels, and sensor mounts are open model files. Print a single
                robot or a full class set on any consumer 3D printer.
              </dd>
            </div>
            <div className={styles.spec}>
              <dt className={styles.specTerm}>Configurable with LEGO Technic</dt>
              <dd className={styles.specDesc}>
                Mounting points follow the Technic standard, so students can move sensors,
                extend the body, and test how a vehicle’s shape changes its behavior — the
                heart of the exercise.
              </dd>
            </div>
            <div className={styles.spec}>
              <dt className={styles.specTerm}>Open source, end to end</dt>
              <dd className={styles.specDesc}>
                The editor, the Arduino code it generates, and the hardware designs are all
                open. Read them, change them, and fit them to how you already teach.
              </dd>
            </div>
          </dl>

          <div className={styles.platformLinks}>
            <Link className={styles.platformLink} to="/docs/hardware/overview">Hardware guide <Arrow /></Link>
            <Link className={styles.platformLink} to="/docs/hardware/bill-of-materials">Parts list <Arrow /></Link>
            <Link className={styles.platformLink} to="/docs">Software docs <Arrow /></Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
