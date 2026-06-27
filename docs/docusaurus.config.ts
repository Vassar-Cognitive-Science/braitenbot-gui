import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const githubRepo = 'https://github.com/Vassar-Cognitive-Science/braitenbot-gui';

const config: Config = {
  title: 'BraitenBot',
  tagline: 'Design Braitenberg vehicles. Study how behavior emerges.',
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

  headTags: [
    {
      // Crisp vector favicon for modern browsers; favicon.ico above is the fallback.
      tagName: 'link',
      attributes: { rel: 'icon', type: 'image/svg+xml', href: '/braitenbot-gui/img/favicon.svg' },
    },
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    },
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
    },
  ],

  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  ],

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
    // Rendered by the swizzled colophon component in src/theme/Footer.
    footer: {
      links: [
        {
          title: 'Software',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/installation' },
            { label: 'Tutorials', to: '/docs/tutorials/your-first-vehicle' },
            { label: 'Nodes', to: '/docs/guide/nodes' },
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
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['arduino', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
