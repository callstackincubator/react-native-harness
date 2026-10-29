import { GLOBAL_EXPECT } from '@vitest/expect';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../globals.js';

const transferScreenshot = vi.fn(async () => ({
  path: '/project/received.png',
}));
const matchImageSnapshot = vi.fn();

vi.mock('../client/store.js', () => ({
  getHandle: () => ({ transferScreenshot, matchImageSnapshot }),
}));

vi.mock('../runner/index.js', () => ({
  getHarnessContext: () => ({
    testFilePath: '/project/screen.harness.tsx',
    runner: 'android',
  }),
}));

// The runtime's expect module installs itself as the global expect; Vitest's
// own expect is put back once the tests are done.
const vitestGlobalExpect = Object.getOwnPropertyDescriptor(
  globalThis,
  GLOBAL_EXPECT
);
const { expect: harnessExpect } = await import('../expect/expect.js');

afterAll(() => {
  if (vitestGlobalExpect) {
    Object.defineProperty(globalThis, GLOBAL_EXPECT, vitestGlobalExpect);
  }
});

const screenshot = { data: new Uint8Array(4), width: 1, height: 1 };

describe('toMatchImageSnapshot', () => {
  beforeEach(() => {
    transferScreenshot.mockClear();
    matchImageSnapshot.mockReset();
  });

  it('fails with the message of a comparison that did not pass', async () => {
    matchImageSnapshot.mockResolvedValueOnce({
      pass: false,
      message: 'New snapshot was not written',
    });

    await expect(
      harnessExpect(screenshot).toMatchImageSnapshot({ name: 'square' })
    ).rejects.toThrow('New snapshot was not written');
  });

  it('refuses .not before a snapshot is compared or written', async () => {
    await expect(
      harnessExpect(screenshot).not.toMatchImageSnapshot({ name: 'square' })
    ).rejects.toThrow('`.not` cannot be used with `.toMatchImageSnapshot()`.');

    expect(transferScreenshot).not.toHaveBeenCalled();
    expect(matchImageSnapshot).not.toHaveBeenCalled();
  });
});
