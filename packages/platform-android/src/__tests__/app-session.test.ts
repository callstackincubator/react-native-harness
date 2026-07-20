import { describe, expect, it } from 'vitest';
import type { Subprocess } from '@react-native-harness/tools';
import { createAndroidAppSession } from '../app-session.js';

// Mimics nano-spawn: the async iterator only ends once its abort signal
// fires, matching how startLogcat's real subprocess reacts to abort.
const createAbortableLogcatProcess = (signal: AbortSignal): Subprocess =>
  ({
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<{ done: true; value: undefined }>((resolve) => {
          if (signal.aborted) {
            resolve({ done: true, value: undefined });
            return;
          }
          signal.addEventListener(
            'abort',
            () => resolve({ done: true, value: undefined }),
            { once: true }
          );
        }),
    }),
    catch: () => undefined,
  }) as unknown as Subprocess;

describe('createAndroidAppSession', () => {
  it('combines the session-lifetime signal with its own logcat abort controller', async () => {
    let capturedSignal: AbortSignal | undefined;
    const controller = new AbortController();

    const session = await createAndroidAppSession({
      appUid: 1,
      bundleId: 'com.example',
      startApp: async () => undefined,
      stopApp: async () => undefined,
      getAppPid: async () => null,
      getLogcatTimestamp: async () => '00:00:00.000',
      startLogcat: (_args, options) => {
        capturedSignal = options.signal;
        return createAbortableLogcatProcess(options.signal);
      },
      signal: controller.signal,
    });

    expect(capturedSignal?.aborted).toBe(false);

    controller.abort();

    expect(capturedSignal?.aborted).toBe(true);

    await session.dispose();
  });

  it('still aborts the logcat signal via dispose() with no external signal provided', async () => {
    let capturedSignal: AbortSignal | undefined;

    const session = await createAndroidAppSession({
      appUid: 1,
      bundleId: 'com.example',
      startApp: async () => undefined,
      stopApp: async () => undefined,
      getAppPid: async () => null,
      getLogcatTimestamp: async () => '00:00:00.000',
      startLogcat: (_args, options) => {
        capturedSignal = options.signal;
        return createAbortableLogcatProcess(options.signal);
      },
    });

    expect(capturedSignal?.aborted).toBe(false);

    await session.dispose();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
