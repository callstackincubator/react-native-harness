import type { Diagnostics, DiagnosticSpan } from '@react-native-harness/tools';
import type { HarnessBridge } from '@react-native-harness/bridge/server';
import type { BridgeEvents } from '@react-native-harness/bridge';
import type { MetroInstance, ReportableEvent } from '@react-native-harness/bundler-metro';

/**
 * Span/mark derivers translate existing domain event streams (Metro build
 * events, bridge/device events) into diagnostics entries. This is the only
 * place in the jest package that maps event shapes to diagnostic labels -
 * business logic elsewhere stays free of diagnostics calls.
 */

const noopDispose = (): void => undefined;

/**
 * Observes Metro's reporter event stream and derives:
 * - `metro.bundle.build` spans, correlated by `buildID` across
 *   bundle_build_started -> bundle_build_done|bundle_build_failed.
 * - `metro.bundle.request` marks from bundle_request_observed events.
 */
export const observeMetroEvents = (
  events: MetroInstance['events'],
  diagnostics: Diagnostics
): (() => void) => {
  if (!diagnostics.enabled) {
    return noopDispose;
  }

  const inflightBuilds = new Map<string, DiagnosticSpan>();

  const listener = (event: ReportableEvent): void => {
    switch (event.type) {
      case 'bundle_build_started': {
        const span = diagnostics.start('metro.bundle.build', {
          buildID: event.buildID,
          platform: event.bundleDetails.platform,
          entryFile: event.bundleDetails.entryFile,
          dev: event.bundleDetails.dev,
        });
        inflightBuilds.set(event.buildID, span);
        return;
      }
      case 'bundle_build_done': {
        const span = inflightBuilds.get(event.buildID);
        inflightBuilds.delete(event.buildID);
        span?.end();
        return;
      }
      case 'bundle_build_failed': {
        const span = inflightBuilds.get(event.buildID);
        inflightBuilds.delete(event.buildID);
        span?.fail(new Error(`Metro bundle build ${event.buildID} failed`));
        return;
      }
      case 'bundle_request_observed': {
        diagnostics.mark('metro.bundle.request', {
          requestKind: event.requestKind,
          platform: event.platform,
        });
        return;
      }
      default:
        return;
    }
  };

  events.addListener(listener);
  return () => {
    events.removeListener(listener);
  };
};

type MinimalBridge = Pick<HarnessBridge, 'on' | 'off'>;

/**
 * Observes bridge connection lifecycle and device-reported bridge events and
 * derives:
 * - `bridge.connected` / `bridge.disconnected` marks.
 * - `client.bundle.module`, `client.setup-file`, `client.collect`,
 *   `client.suite`, `client.test` completed spans, recorded via
 *   diagnostics.record() since these events arrive with a `duration` already
 *   measured on the (unsynced) device clock; we anchor them at host receipt
 *   time instead of trusting the device's absolute clock.
 */
export const observeBridgeEvents = (
  bridge: MinimalBridge,
  diagnostics: Diagnostics
): (() => void) => {
  if (!diagnostics.enabled) {
    return noopDispose;
  }

  const onConnected = (): void => {
    diagnostics.mark('bridge.connected');
  };

  const onDisconnected = (): void => {
    diagnostics.mark('bridge.disconnected');
  };

  const onEvent = (event: BridgeEvents): void => {
    switch (event.type) {
      case 'module-bundling-finished':
        diagnostics.record({
          label: 'client.bundle.module',
          duration: event.duration,
          attrs: { file: event.file },
        });
        return;
      case 'module-bundling-failed':
        diagnostics.record({
          label: 'client.bundle.module',
          duration: event.duration,
          attrs: { file: event.file },
          status: 'error',
        });
        return;
      case 'setup-file-bundling-finished':
        diagnostics.record({
          label: 'client.setup-file',
          duration: event.duration,
          attrs: { file: event.file, setupType: event.setupType },
        });
        return;
      case 'setup-file-bundling-failed':
        diagnostics.record({
          label: 'client.setup-file',
          duration: event.duration,
          attrs: { file: event.file, setupType: event.setupType },
          status: 'error',
        });
        return;
      case 'collection-finished':
        diagnostics.record({
          label: 'client.collect',
          duration: event.duration,
          attrs: { file: event.file, totalTests: event.totalTests },
        });
        return;
      case 'suite-finished':
        diagnostics.record({
          label: 'client.suite',
          duration: event.duration,
          attrs: { file: event.file, name: event.name, status: event.status },
          status: event.status === 'failed' ? 'error' : 'ok',
        });
        return;
      case 'test-finished':
        diagnostics.record({
          label: 'client.test',
          duration: event.duration,
          attrs: { file: event.file, name: event.name, status: event.status },
          status: event.status === 'failed' ? 'error' : 'ok',
        });
        return;
      default:
        return;
    }
  };

  bridge.on('connected', onConnected);
  bridge.on('disconnected', onDisconnected);
  bridge.on('event', onEvent);

  return () => {
    bridge.off('connected', onConnected);
    bridge.off('disconnected', onDisconnected);
    bridge.off('event', onEvent);
  };
};
