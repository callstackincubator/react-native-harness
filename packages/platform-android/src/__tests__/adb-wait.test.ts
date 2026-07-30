import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

// The global test/setup.ts mocks '../adb.js' wholesale (including
// waitForEmulator itself), which is right for consumers of this module but
// defeats the purpose here: this suite exercises the *real* polling loop
// (and its private waitWithSignal helper) to catch timer/listener leaks.
// Re-declaring the mock for this file restores the actual implementation,
// while `spawn` and `getAdbBinaryPath` (genuine cross-module imports) are
// swapped out to keep `getDeviceIds()` from touching a real adb binary.
vi.mock('../adb.js', async () => {
  const actual = await vi.importActual<typeof import('../adb.js')>(
    '../adb.js'
  );

  return actual;
});

vi.mock('../environment.js', async () => {
  const actual = await vi.importActual<typeof import('../environment.js')>(
    '../environment.js'
  );

  return { ...actual, getAdbBinaryPath: () => '/fake/sdk/platform-tools/adb' };
});

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return { ...actual, spawn: mocks.spawn };
});

const { waitForEmulator } = await import('../adb.js');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('waitForEmulator polling', () => {
  it('does not leak an abort listener per poll iteration when the delay wins', async () => {
    vi.useFakeTimers();
    // No matching device on any poll: `adb devices` reports an empty list.
    mocks.spawn.mockResolvedValue({ stdout: 'List of devices attached\n' });

    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const resultPromise = waitForEmulator('Test_AVD', controller.signal);
    resultPromise.catch(() => undefined);

    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
    }

    // Regression: each 1s poll iteration used to add an 'abort' listener
    // to the local waitForAbort helper that was never removed when the
    // delay (not the abort) won the race, leaking one listener per second
    // of polling against this session-lifetime signal.
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    const addCallsBeforeAbort = addSpy.mock.calls.length;

    controller.abort(new Error('teardown'));
    await expect(resultPromise).rejects.toThrow('teardown');

    // Every listener added while losing the race — including the one still
    // pending when the abort itself won — must be removed again.
    expect(removeSpy).toHaveBeenCalledTimes(addCallsBeforeAbort);
  });

  it('clears the pending 1s poll timer when the signal aborts mid-wait', async () => {
    vi.useFakeTimers();
    mocks.spawn.mockResolvedValue({ stdout: 'List of devices attached\n' });

    const controller = new AbortController();
    const resultPromise = waitForEmulator('Test_AVD', controller.signal);
    resultPromise.catch(() => undefined);

    // Let the loop enter its 1s wait, then abort before the timer fires.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('teardown'));

    await expect(resultPromise).rejects.toThrow('teardown');
    // Regression: the bare setTimeout-backed `wait()` used to have no
    // handle to clear, so it stayed alive in the event loop for the rest
    // of the 1s interval even after the abort branch won.
    expect(vi.getTimerCount()).toBe(0);
  });
});
