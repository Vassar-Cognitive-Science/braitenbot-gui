---
title: Quick Reference
displayed_sidebar: instructorSidebar
---

# Quick Reference

Wiring patterns for when students go off-script. Each entry: the problem, the fix, and the one gotcha that trips people up.

import InteractiveDiagram from '@site/src/components/InteractiveDiagram';

## Latch

**Problem:** a behavior should outlast its trigger (a bump should keep the robot backing up after the bump ends).

**Wiring:** feed a **Summation**'s own output back into itself through a **Delay**, so each tick keeps some leftover signal instead of dropping it. Add a **Threshold** after it for a hard on/off latch instead of a decay. See [Memory](./lessons/latches-with-delay).

<InteractiveDiagram
  diagram={{
    loopPeriodMs: 20,
    nodes: [
      { id: 'trigger', type: 'sensor-digital', label: 'Trigger', x: 60, y: 20, arduinoPort: '2', pullup: true },
      { id: 'sum', type: 'compute-summation', label: 'Latch', x: 60, y: 170 },
      { id: 'delay', type: 'compute-delay', label: 'Delay', x: 260, y: 170, delayMs: 20 },
      { id: 'motor', type: 'servo-cr', label: 'Output', x: 60, y: 320, servoPin: '5' },
    ],
    connections: [
      { id: 'c1', from: 'trigger', to: 'sum', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'sum', to: 'motor', weight: 0.5, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', labelT: 0.26, from: 'sum', to: 'delay', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c4', labelT: 0.48, from: 'delay', to: 'sum', weight: 0.9, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="Tap Trigger once, briefly. It lets go instantly, but the Delay loop keeps Output driven."
/>

**Gotcha:** tune `delayMs` against the loop period; too short and the signal washes out before the effect lasts.

## Subsumption

**Problem:** several behaviors compete for the same motor, most urgent should win, no if/else.

**Wiring:** build each behavior as its own branch driving the same output, then combine with **Max** (or **Min**), not **Summation**, so the hardest-driving layer wins outright. See [Nobody Home](./lessons/subsumption-architecture).

<InteractiveDiagram
  initialInputs={{ 'avoid': 80 }}
  diagram={{
    nodes: [
      { id: 'cruise', type: 'constant', label: 'Cruise', x: 20, y: 20, constantValue: 40 },
      { id: 'avoid', type: 'sensor-analog', label: 'Avoid', x: 220, y: 20, arduinoPort: 'A0' },
      { id: 'arbitrate', type: 'compute-max', label: 'Max', x: 120, y: 160 },
      { id: 'motor', type: 'servo-cr', label: 'Wheel', x: 120, y: 300, servoPin: '5' },
    ],
    connections: [
      { id: 'c1', from: 'cruise', to: 'arbitrate', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'avoid', to: 'arbitrate', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', from: 'arbitrate', to: 'motor', weight: 1.0, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="Drag Avoid below Cruise's 40 and back above it: Max always passes whichever layer is louder, no gate needed."
/>

**Gotcha:** every layer must share one output sign/scale convention, or opposite conventions fight instead of composing. Normalize ranges before combining.

## Debounce

**Problem:** a chattering digital or bump sensor makes the robot twitch.

**Wiring:** run the sensor through a **Threshold** to clean up marginal readings, then a **Delay** to hold the triggered state for a minimum dwell before it can drop.

<InteractiveDiagram
  diagram={{
    loopPeriodMs: 20,
    nodes: [
      { id: 'bump', type: 'sensor-digital', label: 'Bump', x: 60, y: 20, arduinoPort: '2', pullup: true },
      { id: 'clean', type: 'compute-threshold', label: 'Clean', x: 60, y: 150, threshold: 50 },
      { id: 'hold', type: 'compute-delay', label: 'Hold', x: 60, y: 280, delayMs: 100 },
      { id: 'motor', type: 'servo-cr', label: 'Wheel', x: 60, y: 410, servoPin: '5' },
    ],
    connections: [
      { id: 'c1', from: 'bump', to: 'clean', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'clean', to: 'hold', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', from: 'hold', to: 'motor', weight: 0.6, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="Threshold squares off a jittery reading; Delay holds it for a minimum dwell before Wheel can drop it."
/>

**Gotcha:** dwell time is a tradeoff; too long merges two real bumps in quick succession into one event.

## Blend vs. arbitrate

**Problem:** "average two influences" (Summation) and "let one win" (Min/Max) are different patterns, not the same one with different weights.

**Wiring:** **Summation** blends: every input contributes proportionally. **Min**/**Max** arbitrate: only the more extreme input wins, undiluted.

<InteractiveDiagram
  initialInputs={{ 'wander': 30, 'avoid': 80 }}
  diagram={{
    nodes: [
      { id: 'wander', type: 'sensor-analog', label: 'Wander', x: 20, y: 20, arduinoPort: 'A0' },
      { id: 'avoid', type: 'sensor-analog', label: 'Avoid', x: 220, y: 20, arduinoPort: 'A1' },
      { id: 'blend', type: 'compute-summation', label: 'Summation (blend)', x: 20, y: 170 },
      { id: 'arbitrate', type: 'compute-max', label: 'Max (arbitrate)', x: 220, y: 170 },
    ],
    connections: [
      { id: 'c1', from: 'wander', to: 'blend', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'avoid', to: 'blend', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', from: 'wander', to: 'arbitrate', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c4', from: 'avoid', to: 'arbitrate', weight: 1.0, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="Same two inputs: Summation adds them together, Max only ever passes the stronger one through."
/>

**Gotcha:** wiring "avoid obstacle" through Summation with "wander" just slows the drive into the wall. Obstacle avoidance almost always wants Max/Min.

## Oscillators

**Problem:** with no stimulus, the robot should still move rather than go idle.

**Wiring:** wire an **Oscillator** (regular sweep) or **Noise** (organic-looking) into a motor directly, or as one input to a **Summation** so it adds a baseline drive that sensors bias on top of.

<InteractiveDiagram
  initialInputs={{ 'light': 0 }}
  diagram={{
    nodes: [
      { id: 'osc', type: 'compute-oscillator', label: 'Explore', x: 20, y: 20, frequencyHz: 0.4, amplitude: 60 },
      { id: 'light', type: 'sensor-analog', label: 'Light', x: 220, y: 20, arduinoPort: 'A0' },
      { id: 'sum', type: 'compute-summation', label: 'Drive', x: 120, y: 160 },
      { id: 'motor', type: 'servo-cr', label: 'Wheel', x: 120, y: 300, servoPin: '5' },
    ],
    connections: [
      { id: 'c1', from: 'osc', to: 'sum', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'light', to: 'sum', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', from: 'sum', to: 'motor', weight: 1.0, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="With no light, Explore alone drives a gentle wander; raise Light and it adds on top."
/>

**Gotcha:** oscillator frequency interacts with the loop period; too fast aliases against the tick rate and looks erratic. Start slow.

## Opponent coding

**Problem:** the robot should tell two conditions apart (say red vs. blue), not just react harder to one.

**Wiring:** wire one channel into a **Summation** with a positive weight and a competing channel into the same Summation with a negative weight, so the *difference* drives behavior. Add a **Threshold** for a clean decision. See [Taste](./lessons/color-discrimination).

<InteractiveDiagram
  initialInputs={{ 'color:red': 40, 'color:green': 15, 'color:blue': 10, 'color:clear': 20 }}
  diagram={{
    nodes: [
      { id: 'color', type: 'sensor-color', label: 'Floor Color', x: 120, y: 20 },
      { id: 'diff', type: 'compute-summation', label: 'Red − Blue', x: 120, y: 170 },
      { id: 'decide', type: 'compute-threshold', label: 'Redder?', x: 120, y: 300, threshold: 15 },
    ],
    connections: [
      { id: 'c1', from: 'color', fromPort: 'red', to: 'diff', weight: 1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c2', from: 'color', fromPort: 'blue', to: 'diff', weight: -1.0, transferMode: 'linear', transferPoints: [] },
      { id: 'c3', from: 'diff', to: 'decide', weight: 1.0, transferMode: 'linear', transferPoints: [] },
    ],
  }}
  caption="Same sensor, two channels, opposite signs: the difference, not either channel alone, drives the decision."
/>

**Gotcha:** the two channels need comparable ranges first, or whichever reads higher naturally dominates the difference regardless of weights.
