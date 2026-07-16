/**
 * Coverage for useDiagramPersistence's file-open listeners: `app://open-path`
 * (the landing page's recent-files click-to-open) and `menu://load` — both
 * must apply the parsed file, record it as a recent, and fire onDiagramOpened
 * so App can switch to the editor; failures must error without applying.
 *
 * There's no existing precedent in this repo for testing a hook with
 * effects — tests run in vitest's default `node` environment (no jsdom), so
 * this uses `react-test-renderer` (no DOM required) to actually mount the
 * hook and let its effects register the mocked Tauri listener, and stubs the
 * minimal `window`/`localStorage` surface the hook touches.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useDiagramPersistence, type DiagramPersistenceOptions } from '../useDiagramPersistence';
import { serialize, type DiagramState } from '../../lib/diagramFile';
import { RECENT_FILES_STORAGE_KEY } from '../../lib/recentFiles';

type ListenHandler = (event: { payload: unknown }) => void | Promise<void>;

const listenMock = vi.fn();
const askMock = vi.fn();
const messageMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: (...args: unknown[]) => askMock(...args),
  message: (...args: unknown[]) => messageMock(...args),
}));

// isTauri() checks `'__TAURI_INTERNALS__' in window`, and the autosave effect
// calls `window.setTimeout`/`clearTimeout` — alias `window` to `globalThis` so
// both work without pulling in jsdom. The mount-restore effect also reads
// `localStorage` directly (bare global, matching src/lib/__tests__/primaryAction.test.ts's
// in-memory stand-in).
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
  (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

function initialState(): DiagramState {
  return {
    nodes: [],
    connections: [],
    loopPeriodMs: 20,
    capWeights: true,
    pulseDurationMs: 200,
    compoundTypes: [],
    comments: [],
  };
}

/** Captures the handler passed to each listen() call by event name, so tests
 *  can invoke a specific listener directly instead of needing a real event bus. */
function captureListeners() {
  const handlers = new Map<string, ListenHandler>();
  listenMock.mockImplementation((event: string, handler: ListenHandler) => {
    handlers.set(event, handler);
    return Promise.resolve(() => handlers.delete(event));
  });
  return handlers;
}

function TestHarness(props: DiagramPersistenceOptions) {
  useDiagramPersistence(props);
  return null;
}

async function mount(props: DiagramPersistenceOptions) {
  await act(async () => {
    TestRenderer.create(React.createElement(TestHarness, props));
  });
}

function storedRecents(): Array<{ path: string; name: string }> {
  const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<{ path: string; name: string }>) : [];
}

describe('useDiagramPersistence — file-open listeners', () => {
  beforeEach(() => {
    listenMock.mockReset();
    askMock.mockReset();
    messageMock.mockReset();
    invokeMock.mockReset();
    localStorage.clear();
  });

  it('app://open-path reads the file, applies it, records the recent, and fires onDiagramOpened', async () => {
    const handlers = captureListeners();
    askMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue(serialize(initialState()));
    const applyDiagram = vi.fn();
    const onDiagramOpened = vi.fn();

    await mount({
      state: initialState(),
      applyDiagram,
      // Non-pristine so confirmReplace actually calls ask() instead of
      // short-circuiting to true.
      isPristine: false,
      resetToDefault: vi.fn(),
      sessionRole: null,
      onDiagramOpened,
    });

    const handler = handlers.get('app://open-path');
    expect(handler).toBeDefined();

    const path = 'C:\\designs\\my-vehicle.json';
    await act(async () => {
      await handler!({ payload: { path } });
    });

    expect(invokeMock).toHaveBeenCalledWith('read_diagram', { path });
    expect(askMock).toHaveBeenCalledWith(
      expect.stringContaining('Replace the current diagram with this file?'),
      expect.objectContaining({ title: 'Open Recent' }),
    );
    expect(applyDiagram).toHaveBeenCalledTimes(1);
    expect(applyDiagram.mock.calls[0][0]).toMatchObject({ loopPeriodMs: 20 });
    expect(onDiagramOpened).toHaveBeenCalledTimes(1);
    expect(messageMock).not.toHaveBeenCalled();
    const recents = storedRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ path, name: 'my-vehicle' });
  });

  it('app://open-path with an unreadable file errors without applying anything', async () => {
    const handlers = captureListeners();
    askMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue('not valid json');
    const applyDiagram = vi.fn();
    const onDiagramOpened = vi.fn();

    await mount({
      state: initialState(),
      applyDiagram,
      isPristine: false,
      resetToDefault: vi.fn(),
      sessionRole: null,
      onDiagramOpened,
    });

    const handler = handlers.get('app://open-path');
    expect(handler).toBeDefined();

    await act(async () => {
      await handler!({ payload: { path: 'C:\\gone.json' } });
    });

    expect(messageMock).toHaveBeenCalledTimes(1);
    expect(messageMock.mock.calls[0][0]).toContain('Failed to open diagram');
    expect(applyDiagram).not.toHaveBeenCalled();
    expect(onDiagramOpened).not.toHaveBeenCalled();
    expect(askMock).not.toHaveBeenCalled();
    expect(storedRecents()).toHaveLength(0);
  });

  it('menu://load applies the picked file, records it, and fires onDiagramOpened', async () => {
    const handlers = captureListeners();
    askMock.mockResolvedValue(true);
    const path = '/home/sam/robots/fear.json';
    invokeMock.mockResolvedValue({ path, contents: serialize(initialState()) });
    const applyDiagram = vi.fn();
    const onDiagramOpened = vi.fn();

    await mount({
      state: initialState(),
      applyDiagram,
      isPristine: false,
      resetToDefault: vi.fn(),
      sessionRole: null,
      onDiagramOpened,
    });

    const handler = handlers.get('menu://load');
    expect(handler).toBeDefined();

    await act(async () => {
      await handler!({ payload: undefined });
    });

    expect(invokeMock).toHaveBeenCalledWith('load_diagram');
    expect(applyDiagram).toHaveBeenCalledTimes(1);
    expect(onDiagramOpened).toHaveBeenCalledTimes(1);
    const recents = storedRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ path, name: 'fear' });
  });
});
