import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  softwareSidebar: [
    // Ordered around a new student's journey: the Lessons come first because
    // they ARE the course — ideally taken inside the desktop app (which bundles
    // them, with in-browser versions here as the no-install fallback) — a
    // single 13-lesson arc that runs software (1–7), then real hardware
    // (8–12, nested under "On the Robot"), then a closing toolbox lesson
    // (13). Install/setup details and reference material follow the course,
    // then real hardware documentation.
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
        'lessons/habits-whims-preferences',
      ],
    },
    {
      type: 'category',
      label: 'Install & Setup',
      items: [
        'getting-started/installation',
        'getting-started/arduino-setup',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'guide/braitenberg-vehicles',
        'guide/nodes',
        'guide/connections',
        'guide/transfer-functions',
        'guide/compound-nodes',
        'guide/simulation',
        'guide/collaborative-sessions',
        'getting-started/editor',
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
