import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Shared student doc entries: the Lessons category, Install & Setup, and the
// "Keep Building" category. Both sidebars below reuse these exact
// objects so the instructor sidebar stays a true superset with no drift. The
// instructor sidebar then adds instructor-only extras around them (the
// teaching page, a Quick Reference, and Under the Hood).
//
// Ordered around a new student's journey: the Lessons come first because
// they ARE the course, ideally taken inside the desktop app (which bundles
// them, with in-browser versions here as the no-install fallback), a
// single 13-lesson arc that runs software (1-7), then real hardware
// (8-12, nested under "On the Robot"), then a closing toolbox lesson
// (13). Install/setup details and the diagram building blocks follow the
// course.
type StudentDocItem =
  | string
  | { type: 'category'; label: string; className?: string; items: StudentDocItem[] };

const studentDocs: StudentDocItem[] = [
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
    // Pointless inside the desktop app (the reader is already running it);
    // hidden there via `html[data-bb-embed] .bb-web-only` in custom.css.
    className: 'bb-web-only',
    items: [
      'getting-started/installation',
      'getting-started/arduino-setup',
    ],
  },
  {
    type: 'category',
    label: 'Keep Building',
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
];

// The instructor sidebar reuses the student docs as `ref` items: refs render
// the same links but don't claim ownership of the doc, so a student doc
// always DISPLAYS the student sidebar (in the app and on the website) and
// paginates through the student course. Without this, each doc would belong
// to both sidebars and Docusaurus would pick one arbitrarily, which is how
// instructor-only entries once leaked into the sidebar students see.
function asRefs(items: StudentDocItem[]): object[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { type: 'ref', id: item }
      : { ...item, items: asRefs(item.items) },
  );
}

const sidebars: SidebarsConfig = {
  // Student-facing sidebar: no teaching entry, students should never be
  // routed to instructor content from here.
  softwareSidebar: ['intro', ...studentDocs],

  // Instructor-facing sidebar: a superset of the student sidebar plus
  // instructor-only extras. The teaching page leads, then Hardware (building
  // the physical robot is an instructor concern, not a student one), then
  // Quick Reference, then the identical student docs (as refs, see above),
  // then Under the Hood at the end (no longer in the student nav). The
  // teaching page and Quick Reference select this sidebar themselves via
  // `displayed_sidebar`; Hardware and Under the Hood display it naturally
  // because they appear in no other sidebar.
  instructorSidebar: [
    'teaching-with-braitenbot',
    {
      type: 'category',
      label: 'Hardware',
      items: [
        'hardware/overview',
        'hardware/bill-of-materials',
        'hardware/3d-models',
        'hardware/assembly',
        'hardware/testing',
        'hardware/supported-hardware',
      ],
    },
    'quick-reference',
    ...asRefs(studentDocs),
    'under-the-hood',
  ],
};

export default sidebars;
