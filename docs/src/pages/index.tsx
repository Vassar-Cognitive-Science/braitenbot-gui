import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

type Card = {
  title: string;
  description: string;
  to: string;
  cta: string;
};

const CARDS: Card[] = [
  {
    title: 'Software',
    description:
      'Design wiring diagrams in the visual editor, simulate the signal flow, and generate an Arduino sketch — no code required.',
    to: '/docs',
    cta: 'Read the software docs',
  },
  {
    title: 'Hardware',
    description:
      'Build your own two-wheeled robot. Parts lists, printable 3D models, and assembly instructions for a DIY BraitenBot.',
    to: '/docs/hardware/overview',
    cta: 'Explore the hardware guide',
  },
];

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <h1 className={styles.heroTitle}>{siteConfig.title}</h1>
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <p className={styles.heroBlurb}>
          Wire sensors to motors on a canvas, watch the behavior emerge, and
          upload it straight to your robot. From light-followers to subsumption
          architectures — built visually, no code required.
        </p>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/install">
            Download the app
          </Link>
          <Link className="button button--secondary button--lg" to="/docs">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Cards() {
  return (
    <section className={styles.cards}>
      <div className="container">
        <div className="row">
          {CARDS.map((card) => (
            <div className="col col--6" key={card.title}>
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>{card.title}</h2>
                <p className={styles.cardDescription}>{card.description}</p>
                <Link className={styles.cardLink} to={card.to}>
                  {card.cta} →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Visual wiring diagrams for Braitenberg vehicles — design, simulate, and upload to your robot.">
      <Hero />
      <main>
        <Cards />
      </main>
    </Layout>
  );
}
