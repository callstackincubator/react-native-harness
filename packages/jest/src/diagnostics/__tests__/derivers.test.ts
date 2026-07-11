import { describe, expect, it } from 'vitest';
import { createDiagnostics, getEmitter } from '@react-native-harness/tools';
import type { ReportableEvent } from '@react-native-harness/bundler-metro';
import type { AppConnection } from '@react-native-harness/bridge/server';
import type { BridgeEvents } from '@react-native-harness/bridge';
import { observeBridgeEvents, observeMetroEvents } from '../derivers.js';

type HarnessBridgeEvents = {
  connected: (connection: AppConnection) => void;
  disconnected: () => void;
  event: (event: BridgeEvents) => void;
};

const createFakeBridge = () => {
  const listeners: { [K in keyof HarnessBridgeEvents]: Set<HarnessBridgeEvents[K]> } = {
    connected: new Set(),
    disconnected: new Set(),
    event: new Set(),
  };

  return {
    on: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => {
      listeners[event].add(listener as never);
    },
    off: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => {
      listeners[event].delete(listener as never);
    },
    emitConnected: () =>
      listeners.connected.forEach((l) =>
        l({} as AppConnection)
      ),
    emitDisconnected: () => listeners.disconnected.forEach((l) => l()),
    emitEvent: (event: BridgeEvents) => listeners.event.forEach((l) => l(event)),
    listenerCounts: () => ({
      connected: listeners.connected.size,
      disconnected: listeners.disconnected.size,
      event: listeners.event.size,
    }),
  };
};

describe('observeMetroEvents', () => {
  it('is a no-op and does not subscribe when diagnostics is disabled', () => {
    const events = getEmitter<ReportableEvent>();
    const diagnostics = createDiagnostics({ enabled: false });

    const dispose = observeMetroEvents(events, diagnostics);
    events.emit({
      type: 'bundle_build_started',
      buildID: '1',
      bundleDetails: {
        bundleType: 'bundle',
        dev: true,
        entryFile: 'index.js',
        minify: false,
        platform: 'ios',
      },
    });

    expect(diagnostics.flush()).toEqual([]);
    dispose();
  });

  it('correlates bundle_build_started/done via buildID into a span', () => {
    const events = getEmitter<ReportableEvent>();
    const diagnostics = createDiagnostics({ enabled: true });
    observeMetroEvents(events, diagnostics);

    events.emit({
      type: 'bundle_build_started',
      buildID: 'build-1',
      bundleDetails: {
        bundleType: 'bundle',
        dev: true,
        entryFile: 'index.js',
        minify: false,
        platform: 'ios',
      },
    });
    events.emit({ type: 'bundle_build_done', buildID: 'build-1' });

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('metro.bundle.build');
    expect(entries[0]?.status).toBe('ok');
    expect(entries[0]?.attrs).toMatchObject({
      buildID: 'build-1',
      platform: 'ios',
      entryFile: 'index.js',
    });
  });

  it('records a failed span for bundle_build_failed', () => {
    const events = getEmitter<ReportableEvent>();
    const diagnostics = createDiagnostics({ enabled: true });
    observeMetroEvents(events, diagnostics);

    events.emit({
      type: 'bundle_build_started',
      buildID: 'build-2',
      bundleDetails: {
        bundleType: 'bundle',
        dev: true,
        entryFile: 'index.js',
        minify: false,
        platform: 'android',
      },
    });
    events.emit({ type: 'bundle_build_failed', buildID: 'build-2' });

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('error');
  });

  it('records a bundle_request_observed mark', () => {
    const events = getEmitter<ReportableEvent>();
    const diagnostics = createDiagnostics({ enabled: true });
    observeMetroEvents(events, diagnostics);

    events.emit({
      type: 'bundle_request_observed',
      platform: 'ios',
      requestKind: 'app',
      timestamp: new Date().toISOString(),
      url: '/index.bundle',
    });

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('metro.bundle.request');
    expect(entries[0]?.kind).toBe('mark');
    expect(entries[0]?.attrs).toEqual({ requestKind: 'app', platform: 'ios' });
  });

  it('dispose() unsubscribes the listener', () => {
    const events = getEmitter<ReportableEvent>();
    const diagnostics = createDiagnostics({ enabled: true });
    const dispose = observeMetroEvents(events, diagnostics);

    dispose();
    events.emit({
      type: 'bundle_request_observed',
      platform: 'ios',
      requestKind: 'app',
      timestamp: new Date().toISOString(),
      url: '/index.bundle',
    });

    expect(diagnostics.flush()).toEqual([]);
  });
});

describe('observeBridgeEvents', () => {
  it('is a no-op and does not subscribe when diagnostics is disabled', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: false });

    observeBridgeEvents(bridge, diagnostics);
    expect(bridge.listenerCounts()).toEqual({ connected: 0, disconnected: 0, event: 0 });
  });

  it('marks bridge.connected and bridge.disconnected', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    bridge.emitConnected();
    bridge.emitDisconnected();

    const entries = diagnostics.flush();
    expect(entries.map((e) => e.label)).toEqual(['bridge.connected', 'bridge.disconnected']);
    expect(entries.every((e) => e.kind === 'mark')).toBe(true);
  });

  it('records client.bundle.module for module bundling events', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    bridge.emitEvent({ type: 'module-bundling-finished', file: 'a.ts', duration: 12 });
    bridge.emitEvent({
      type: 'module-bundling-failed',
      file: 'b.ts',
      duration: 5,
      error: 'boom',
    });

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      label: 'client.bundle.module',
      duration: 12,
      status: 'ok',
      attrs: { file: 'a.ts' },
    });
    expect(entries[1]).toMatchObject({
      label: 'client.bundle.module',
      duration: 5,
      status: 'error',
      attrs: { file: 'b.ts' },
    });
  });

  it('records client.setup-file for setup file bundling events', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    bridge.emitEvent({
      type: 'setup-file-bundling-finished',
      file: 'setup.ts',
      setupType: 'setupFiles',
      duration: 20,
    });

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: 'client.setup-file',
      duration: 20,
      attrs: { file: 'setup.ts', setupType: 'setupFiles' },
    });
  });

  it('records client.collect for collection-finished', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    bridge.emitEvent({
      type: 'collection-finished',
      file: 'a.test.ts',
      duration: 8,
      totalTests: 3,
    });

    const entries = diagnostics.flush();
    expect(entries[0]).toMatchObject({
      label: 'client.collect',
      duration: 8,
      attrs: { file: 'a.test.ts', totalTests: 3 },
    });
  });

  it('records client.suite and client.test with status', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    bridge.emitEvent({
      type: 'suite-finished',
      file: 'a.test.ts',
      name: 'my suite',
      duration: 100,
      status: 'failed',
    });
    bridge.emitEvent({
      type: 'test-finished',
      file: 'a.test.ts',
      suite: 'my suite',
      name: 'my test',
      ancestorTitles: [],
      fullName: 'my suite my test',
      startedAt: Date.now(),
      duration: 15,
      status: 'passed',
    });

    const entries = diagnostics.flush();
    expect(entries[0]).toMatchObject({ label: 'client.suite', status: 'error' });
    expect(entries[1]).toMatchObject({ label: 'client.test', status: 'ok' });
  });

  it('anchors recorded entries near "now - duration" using the host clock', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    observeBridgeEvents(bridge, diagnostics);

    const before = Date.now();
    bridge.emitEvent({ type: 'module-bundling-finished', file: 'a.ts', duration: 50 });
    const after = Date.now();

    const [entry] = diagnostics.flush();
    expect(entry?.startTime).toBeGreaterThanOrEqual(before - 50 - 5);
    expect(entry?.startTime).toBeLessThanOrEqual(after - 50 + 5);
  });

  it('dispose() unsubscribes all listeners', () => {
    const bridge = createFakeBridge();
    const diagnostics = createDiagnostics({ enabled: true });
    const dispose = observeBridgeEvents(bridge, diagnostics);

    dispose();
    expect(bridge.listenerCounts()).toEqual({ connected: 0, disconnected: 0, event: 0 });

    bridge.emitConnected();
    expect(diagnostics.flush()).toEqual([]);
  });
});
