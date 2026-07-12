import { useMemo } from 'react';
import { BraitenbergDiagram } from '../components/BraitenbergDiagram';
import { diagramStore } from '../doc/DiagramStore';
import { stubArduino } from './stubArduino';
import { resolvePreset } from './presets';

// Read the embed's configuration from the iframe URL and seed the shared store
// once, before React mounts, so the editor comes up already showing this embed's
// preset. Persistence is off in playground mode, so this seed is never clobbered
// by (or written back to) localStorage.
const params = new URLSearchParams(window.location.search);
diagramStore.resetDoc(resolvePreset(params));
const traceParam = params.get('trace');
if (traceParam === '1' || traceParam === 'true') {
  diagramStore.setTraceEnabled(true);
}

/**
 * Root of the docs playground: the real editor, minus every hardware and
 * collaboration control, running in a plain browser inside a docs `<iframe>`.
 */
export function PlaygroundApp() {
  const arduino = useMemo(() => stubArduino(), []);
  return (
    <div className="app">
      <main className="app-main">
        <BraitenbergDiagram arduino={arduino} mode="playground" />
      </main>
    </div>
  );
}
