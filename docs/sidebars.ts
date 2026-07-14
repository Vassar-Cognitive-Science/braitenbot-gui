import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  softwareSidebar: [
    // Ordered around a new student's journey: learn the basics by playing the
    // browser-only Lessons first (no install), then get the app, then reach for
    // reference material, then put it on real hardware.
    'intro',
    'teaching-with-braitenbot',
    {
      type: 'category',
      label: 'Lessons',
      items: [
        'lessons/your-first-vehicle',
        'lessons/fear-and-love',
        'lessons/obstacle-avoidance',
        'lessons/color-discrimination',
        'lessons/latches-with-delay',
        'lessons/subsumption-architecture',
        'lessons/say-what-you-mean',
      ],
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/arduino-setup',
        'getting-started/editor',
      ],
    },
    {
      type: 'category',
      label: 'Designing Vehicles',
      items: [
        'guide/braitenberg-vehicles',
        'guide/nodes',
        'guide/connections',
        'guide/transfer-functions',
        'guide/compound-nodes',
        'guide/simulation',
        'guide/collaborative-sessions',
      ],
    },
    {
      type: 'category',
      label: 'On the Robot',
      items: [
        'on-the-robot/first-upload',
        'on-the-robot/photocells',
        'on-the-robot/tof-and-bumpers',
        'on-the-robot/color-sensor',
        'on-the-robot/field-test',
      ],
    },
    'under-the-hood',
  ],

  hardwareSidebar: [
    'hardware/overview',
    'hardware/bill-of-materials',
    'hardware/3d-models',
    'hardware/assembly',
    'hardware/testing',
    'hardware/supported-hardware',
  ],
};

export default sidebars;
