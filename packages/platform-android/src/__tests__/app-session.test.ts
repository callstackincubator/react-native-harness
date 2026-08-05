import { describe, expect, it } from 'vitest';
import type { OwnedProcess, Subprocess } from '@react-native-harness/tools';
import { createAndroidAppSession } from '../app-session.js';

// Mimics nano-spawn: the async iterator only ends once its abort signal
// fires, matching how startLogcat's real subprocess reacts to abort.
const createAbortableLogcatProcess = (): OwnedProcess => {
  const controller = new AbortController();
  const subprocess = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<{ done: true; value: undefined }>((resolve) => {
          if (controller.signal.aborted) {
            resolve({ done: true, value: undefined });
            return;
          }
          controller.signal.addEventListener(
            'abort',
            () => resolve({ done: true, value: undefined }),
            { once: true }
          );
        }),
    }),
    catch: () => undefined,
  } as unknown as Subprocess;
  return { subprocess, dispose: async () => controller.abort() };
};

describe('createAndroidAppSession', () => {
  it('disposes logcat when the session signal aborts', async () => {
    let disposed = false;
    const controller = new AbortController();

    const session = await createAndroidAppSession({
      appUid: 1,
      bundleId: 'com.example',
      startApp: async () => undefined,
      stopApp: async () => undefined,
      getAppPid: async () => null,
      getLogcatTimestamp: async () => '00:00:00.000',
      startLogcat: () => ({
        ...createAbortableLogcatProcess(),
        dispose: async () => { disposed = true; },
      }),
      signal: controller.signal,
    });

    controller.abort();
    await session.dispose();
    expect(disposed).toBe(true);
  });

  it('disposes logcat with no external signal provided', async () => {
    let disposed = false;

    const session = await createAndroidAppSession({
      appUid: 1,
      bundleId: 'com.example',
      startApp: async () => undefined,
      stopApp: async () => undefined,
      getAppPid: async () => null,
      getLogcatTimestamp: async () => '00:00:00.000',
      startLogcat: () => ({
        ...createAbortableLogcatProcess(),
        dispose: async () => { disposed = true; },
      }),
    });

    await session.dispose();
    expect(disposed).toBe(true);
  });
});
