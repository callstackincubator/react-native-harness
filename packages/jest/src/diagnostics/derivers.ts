import type { Diagnostics, DiagnosticSpan } from '@react-native-harness/tools';
import type { HarnessBridge } from '@react-native-harness/bridge/server';
import type { BridgeEvents } from '@react-native-harness/bridge';
import type {
  BundlerEvent,
  BundlerInstance,
  HarnessBundler,
} from '@react-native-harness/bundlers';

/**
 * Span/mark derivers translate existing domain event streams (Metro build
 * events, bridge/device events) into diagnostics entries. This is the only
 * place in the jest package that maps event shapes to diagnostic labels -
 * business logic elsewhere stays free of diagnostics calls.
 */

const noopDispose = (): void => undefined;

/**
 * Observes the bundler's event stream and derives, with `<name>` the bundler's
 * `name` (`metro` for Metro):
 * - `<name>.bundle.build` spans, correlated by `buildId` across
 *   build_started -> build_done|build_failed.
 * - `<name>.bundle.request` marks from entry_requested events.
 */
export const observeBundlerEvents = (
  events: BundlerInstance['events'],
  diagnostics: Diagnostics,
  bundler: Pick<HarnessBundler, 'name' | 'displayName'>
): (() => void) => {
  if (!diagnostics.enabled) {
    return noopDispose;
  }

  const inflightBuilds = new Map<string, DiagnosticSpan>();

  const listener = (event: BundlerEvent): void => {
    switch (event.type) {
      case 'build_started': {
        const span = diagnostics.start(`${bundler.name}.bundle.build`, {
          buildID: event.buildId,
          platform: event.platform,
          entryFile: event.entryFile,
          dev: event.dev,
        });
        inflightBuilds.set(event.buildId, span);
        return;
      }
      case 'build_done': {
        const span = inflightBuilds.get(event.buildId);
        inflightBuilds.delete(event.buildId);
        span?.end();
        return;
      }
      case 'build_failed': {
        const span = inflightBuilds.get(event.buildId);
        inflightBuilds.delete(event.buildId);
        span?.fail(
          new Error(`${bundler.displayName} bundle build ${event.buildId} failed`)
        );
        return;
      }
      case 'entry_requested': {
        diagnostics.mark(`${bundler.name}.bundle.request`, {
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
