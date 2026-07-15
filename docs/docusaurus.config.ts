import path from 'path';
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config, Plugin} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const githubRepo = 'https://github.com/Vassar-Cognitive-Science/braitenbot-gui';

/**
 * Lets the docs site import PURE, browser-safe modules from the desktop app's
 * `src/` (the trace-mode simulation core) via the `@app/*` alias, so tutorials
 * can embed the exact same live simulation the app runs. Rather than duplicate
 * the simulation logic here, InteractiveDiagram imports it from `../src`.
 *
 * The default Docusaurus JS rule (`test: /\.[jt]sx?$/`, `exclude: excludeJS`)
 * already transpiles files outside the site dir — excludeJS only skips
 * node_modules — so no extra loader rule is needed for `../src/*.ts`.
 *
 * React MUST resolve to the docs' own React 19 copy: `../src` files `import
 * 'react'`, and webpack's bare `node_modules` resolution would otherwise walk
 * up to the repo-root React 18. Aliasing react/react-dom prevents a duplicate
 * React (invalid-hook-call) at runtime.
 */
function appSourceAliasPlugin(): Plugin {
  return {
    name: 'app-source-alias',
    configureWebpack() {
      return {
        resolve: {
          alias: {
            '@app': path.resolve(__dirname, '../src'),
            react: path.resolve(__dirname, 'node_modules/react'),
            'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
          },
        },
      };
    },
  };
}

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
    // The app's diagram font — used by the InteractiveDiagram embed (via the
    // shared src/components/diagram.css) so embedded diagrams match the app.
    'https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&display=swap',
  ],

  plugins: [appSourceAliasPlugin],

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
            { label: 'Lessons', to: '/docs/lessons/your-first-vehicle' },
            { label: 'Install & Setup', to: '/docs/getting-started/installation' },
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
