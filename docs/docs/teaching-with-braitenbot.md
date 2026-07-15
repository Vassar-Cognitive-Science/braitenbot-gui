---
title: Teaching with BraitenBot
---

# Teaching with BraitenBot

BraitenBot is a ready-made unit on emergent behavior and sensorimotor
robotics: thirteen lessons that walk students from a single sensor wired to
a motor up to a layered, multi-behavior robot, each one built entirely on
the wiring and weights they set themselves. The first seven run entirely in
software, no hardware required. Five more, grouped as "On the Robot," calibrate
and tune the real sensors and put each circuit from the software
lessons onto a physical kit. A closing lesson rounds out the toolbox with
the node types the course hasn't needed yet. Students with a compatible
laptop should [install the desktop app](/install) and take the whole course
inside it: the lessons are bundled in (they work offline), and every
embedded diagram has an **Upload to bot** button that puts a student's edits
straight onto a real Arduino-driven robot — pick a board and go, no editor
detour. For students who can't install anything — iPads, Chromebooks,
locked-down school machines — every lesson also runs live right here in the
browser, and they can pair with a classmate's app for the uploads.

## The course at a glance

1. **[Your First Vehicle](./lessons/your-first-vehicle)**: one sensor, two
   motors, how a connection and its weight become behavior.
2. **[Fear & Love](./lessons/fear-and-love)**: cross vs. same-side wiring,
   and how it turns the same parts into a creature that chases light or one
   that flees it.
3. **[Don't](./lessons/obstacle-avoidance)**: thresholds and inhibition
   give a vehicle its first "no": obstacle avoidance.
4. **[Taste](./lessons/color-discrimination)**: the color sensor and
   opponent coding, so a vehicle can tell stimuli apart, not just react to
   more or less of one.
5. **[Memory](./lessons/latches-with-delay)**: a feedback loop through a
   delay node, so a signal can outlast the moment that caused it.
6. **[Nobody Home](./lessons/subsumption-architecture)**: layered
   behaviors and compounds, stacked with no central controller anywhere in
   the wiring.
7. **[Say What You Mean](./lessons/say-what-you-mean)**: an optional coda
   on naming, compounds, and comments — making diagrams legible to the
   next human, not the robot.
8. **[First Upload](./on-the-robot/first-upload)**: put Vehicle 1 on real
   wheels, walking the full upload flow from board selection to a working
   robot.
9. **[Eyes: Photocells](./on-the-robot/photocells)**: calibrate and tune the
   two real light sensors, plus the dead-zone and speed-cap curves real
   hardware needs.
10. **[Rangefinders & Bumpers](./on-the-robot/tof-and-bumpers)**: calibrate
    the ToF distance sensors and bump switches, tuning the avoidance
    threshold against real walls.
11. **[The Color Eye](./on-the-robot/color-sensor)**: calibrate the color
    sensor against real floors and lighting.
12. **[Field Test: Let It Loose](./on-the-robot/field-test)**: put the
    full three-layer robot in a room with furniture and let it fend for
    itself.
13. **[Habits, Whims & Preferences](./lessons/habits-whims-preferences)**:
    the rest of the toolbox — internal states via Oscillator, Noise, Min,
    and Max, and the output nodes the course hasn't used yet.

Lessons 1–7 are live, editable circuits embedded right on the page —
identical in the app and in the browser, so a mixed class of installed and
browser-only students works through the same sequence together. Lessons
8–12 shift to the physical robot itself: uploading to it, then calibrating
and tuning the sensors a kit actually needs. Lesson 13 returns to the browser to round
out the toolbox.

## Building the robots

If you want a physical build for the class, the robot is built from
standard, orderable parts and a 3D-printed chassis: nothing proprietary to
source.

- **[Parts List](./hardware/bill-of-materials)**: what to buy and where.
- **[3D Models](./hardware/3d-models)**: printable chassis, wheel, and
  sensor-mount files; print one robot or a full class set on any consumer
  3D printer.
- **[Assembly](./hardware/assembly)**: wiring the sensors, servos, and
  microcontroller together.

:::note[Coming soon]

A full course guide (learning objectives per lesson, suggested pacing, and
assessment ideas) along with an assembly video is in progress and will
be published here.
:::
