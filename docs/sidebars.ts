import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  softwareSidebar: [
    'intro',
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
      ],
    },
    {
      type: 'category',
      label: 'Lessons',
      items: [
        'tutorials/your-first-vehicle',
        'tutorials/light-follower',
        'tutorials/obstacle-avoidance',
        'tutorials/color-discrimination',
        'tutorials/latches-with-delay',
        'tutorials/subsumption-architecture',
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
