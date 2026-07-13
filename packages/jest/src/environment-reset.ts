import { getTimeoutSignal } from '@react-native-harness/tools';
import type { Config as HarnessConfig } from '@react-native-harness/config';

const ignorePromiseRejection = () => undefined;

export type ResetStrategyKind = 'process' | 'runtime';

export type EnvironmentResetStrategy = {
  readonly kind: ResetStrategyKind;
  // Post-condition: bridge connected, runtime ready, crash-monitor state consistent.
  reset(ctx: { testFilePath: string }): Promise<void>;
};

/**
 * Normalizes the `resetEnvironmentBetweenTestFiles` config value into a
 * strategy kind, or `null` when no reset should happen between test files
 * (i.e. the value is `false`).
 */
export const resolveResetStrategyKind = (
  value: HarnessConfig['resetEnvironmentBetweenTestFiles']
): ResetStrategyKind | null => {
  if (value === false) {
    return null;
  }
  if (value === true) {
    return 'process';
  }
  return value;
};

export type ProcessResetStrategyDeps = {
  // Shared with restartApp; killing and relaunching the app process.
  restart: (testFilePath: string) => Promise<void>;
};

/**
 * The 'process' strategy: kill and cold-restart the app process. This is
 * the same implementation `restartApp` uses for crash/timeout recovery.
 */
export const createProcessResetStrategy = (
  deps: ProcessResetStrategyDeps
): EnvironmentResetStrategy => ({
  kind: 'process',
  reset: ({ testFilePath }) => deps.restart(testFilePath),
});

export type RuntimeResetConnection = {
  resetEnvironment: () => Promise<void>;
};

export type RuntimeResetStrategyDeps = {
  // Returns the active app connection, or null if there isn't one.
  getConnection: () => RuntimeResetConnection | null;
  // Opens a window that suppresses crash-monitor disconnect handling;
  // returns a closer to end the window.
  expectDisconnect: () => () => void;
  // Resolves the next time the bridge reports a 'connected' event, or
  // rejects when `signal` aborts.
  waitForReconnect: (signal: AbortSignal) => Promise<void>;
  // Identifies RPC rejections caused by the bridge disconnecting. Inside the
  // expected-disconnect window these mean the reload tore the runtime down
  // before the RPC ack flushed — the reload is in flight, not failed.
  isDisconnectError: (error: unknown) => boolean;
  // Reconnect timeout in ms (the configured bundleStartTimeout).
  timeoutMs: number;
};

/**
 * The 'runtime' strategy: reload the JS runtime in place (DevSettings.reload()
 * on native, window.location.reload() on web) via the resetEnvironment RPC,
 * and wait for the bridge to reconnect. The app process stays alive
 * throughout, so the crash monitor's expected-disconnect window is used to
 * avoid misclassifying the intentional disconnect as a runtime failure.
 */
export const createRuntimeResetStrategy = (
  deps: RuntimeResetStrategyDeps
): EnvironmentResetStrategy => ({
  kind: 'runtime',
  reset: async () => {
    const connection = deps.getConnection();
    if (!connection) {
      throw new Error('No active app connection to reset the runtime on');
    }

    const closeWindow = deps.expectDisconnect();
    try {
      // Start listening for the reconnect before firing the RPC, so a fast
      // reload can't reconnect before we're watching for it.
      const reconnected = deps.waitForReconnect(getTimeoutSignal(deps.timeoutMs));
      // Observe the rejection even when the RPC throws first, so the timeout
      // abort firing later can't become an unhandled rejection. (.catch()
      // returns a new promise; the original is what gets awaited below.)
      reconnected.catch(ignorePromiseRejection);

      try {
        await connection.resetEnvironment();
      } catch (error) {
        // The reload can tear the runtime down before the RPC ack flushes.
        // A disconnect-flavored rejection means the reload is in flight, so
        // keep waiting for the reconnect; anything else is a real failure.
        if (!deps.isDisconnectError(error)) {
          throw error;
        }
      }

      await reconnected;
    } finally {
      closeWindow();
    }
  },
});

export type EscalationOptions = {
  // Invoked when the primary strategy fails and the fallback is about to run.
  onEscalate?: (error: unknown) => void;
};

/**
 * Wraps a primary strategy so that any failure (no active connection, RPC
 * error, reconnect timeout, ...) falls back to running `fallback` instead of
 * propagating the error. The composite reports the primary's `kind`, since
 * that's the strategy that was requested.
 */
export const withEscalation = (
  primary: EnvironmentResetStrategy,
  fallback: EnvironmentResetStrategy,
  options: EscalationOptions = {}
): EnvironmentResetStrategy => ({
  kind: primary.kind,
  reset: async (ctx) => {
    try {
      await primary.reset(ctx);
    } catch (error) {
      options.onEscalate?.(error);
      await fallback.reset(ctx);
    }
  },
});
