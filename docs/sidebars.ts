import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/arduino-setup',
        'getting-started/editor-overview',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'concepts/braitenberg-vehicles',
        'concepts/signal-flow',
        'concepts/transfer-functions',
        'concepts/compound-nodes',
        'concepts/code-generation',
        'concepts/trace-simulation',
      ],
    },
  ],

  tutorialSidebar: [
    {
      type: 'category',
      label: 'Tutorials',
      items: [
        'tutorials/your-first-vehicle',
        'tutorials/light-follower',
        'tutorials/obstacle-avoidance',
        'tutorials/line-follower',
        'tutorials/transfer-curves',
        'tutorials/latches-with-delay',
        'tutorials/subsumption-architecture',
        'tutorials/compound-reuse',
      ],
    },
  ],

  referenceSidebar: [
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/node-types',
        'reference/connections',
        'reference/keyboard-shortcuts',
        'reference/file-format',
        'reference/generated-code',
        'reference/supported-hardware',
      ],
    },
  ],
};

export default sidebars;
