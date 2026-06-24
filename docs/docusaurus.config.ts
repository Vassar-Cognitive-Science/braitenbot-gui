import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const githubRepo = 'https://github.com/Vassar-Cognitive-Science/braitenbot-gui';

const config: Config = {
  title: 'BraitenBot',
  tagline: 'Visual wiring diagrams for Braitenberg vehicles',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://vassar-cognitive-science.github.io',
  baseUrl: '/braitenbot-gui/',

  organizationName: 'Vassar-Cognitive-Science',
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
          routeBasePath: '/docs',
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
          sidebarId: 'softwareSidebar',
          position: 'left',
          label: 'Software',
        },
        {
          type: 'docSidebar',
          sidebarId: 'hardwareSidebar',
          position: 'left',
          label: 'Hardware',
        },
        {
          to: '/install',
          label: 'Install',
          position: 'left',
        },
        {
          href: githubRepo,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Software',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/installation' },
            { label: 'Tutorials', to: '/docs/tutorials/your-first-vehicle' },
            { label: 'Reference', to: '/docs/reference/node-types' },
          ],
        },
        {
          title: 'Hardware',
          items: [
            { label: 'Overview', to: '/docs/hardware/overview' },
            { label: 'Bill of Materials', to: '/docs/hardware/bill-of-materials' },
            { label: '3D Models', to: '/docs/hardware/3d-models' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'Install', to: '/install' },
            { label: 'GitHub', href: githubRepo },
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
