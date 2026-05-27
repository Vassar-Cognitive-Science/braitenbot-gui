import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'BraitenBot',
  tagline: 'Visual wiring diagrams for Braitenberg vehicles',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://braitenbot.github.io',
  baseUrl: '/braitenbot-gui/',

  organizationName: 'braitenbot',
  projectName: 'braitenbot-gui',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'BraitenBot',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Tutorials',
        },
        {
          type: 'docSidebar',
          sidebarId: 'referenceSidebar',
          position: 'left',
          label: 'Reference',
        },
        {
          href: 'https://github.com/jspsych/braitenbot-gui',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/getting-started/installation' },
            { label: 'Tutorials', to: '/tutorials/your-first-vehicle' },
            { label: 'Reference', to: '/reference/node-types' },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/jspsych/braitenbot-gui',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} BraitenBot. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['arduino', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
