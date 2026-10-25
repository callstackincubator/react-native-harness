import { GLOBAL_EXPECT } from '@vitest/expect';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transferScreenshot: vi.fn(),
  matchImageSnapshot: vi.fn(),
}));

vi.mock('../../client/store.js', () => ({
  getHandle: () => ({
    transferScreenshot: mocks.transferScreenshot,
    matchImageSnapshot: mocks.matchImageSnapshot,
  }),
}));

vi.mock('../../runner/index.js', () => ({
  getHarnessContext: () => ({
    testFilePath: 'screenshot.harness.tsx',
    runner: 'android',
  }),
}));

// Importing the runtime's expect replaces Vitest's global expect, so it is put back after the tests.
const vitestGlobalExpect = Object.getOwnPropertyDescriptor(
  globalThis,
  GLOBAL_EXPECT
);
const { expect: harnessExpect } = await import('../expect.js');

afterAll(() => {
  if (vitestGlobalExpect) {
    Object.defineProperty(globalThis, GLOBAL_EXPECT, vitestGlobalExpect);
  }
});

const nullScreenshotMessage =
  'The screenshot for the "submit-button" snapshot could not be captured: screen.screenshot() resolved null.';

describe('toMatchImageSnapshot', () => {
  beforeEach(() => {
    mocks.transferScreenshot.mockReset();
    mocks.matchImageSnapshot.mockReset();
  });

  it('compares a captured screenshot with its snapshot', async () => {
    const screenshot = { data: new Uint8Array(4), width: 1, height: 1 };
    mocks.transferScreenshot.mockResolvedValueOnce({ path: 'received.png' });
    mocks.matchImageSnapshot.mockResolvedValueOnce({
      pass: true,
      message: 'Images match',
    });

    await harnessExpect(screenshot).toMatchImageSnapshot({
      name: 'submit-button',
    });

    expect(mocks.transferScreenshot).toHaveBeenCalledWith(screenshot.data, {
      width: 1,
      height: 1,
    });
    expect(mocks.matchImageSnapshot).toHaveBeenCalledWith(
      { path: 'received.png' },
      'screenshot.harness.tsx',
      { name: 'submit-button' },
      'android'
    );
  });

  it('fails naming the capture when the screenshot is null', async () => {
    await expect(
      harnessExpect(null).toMatchImageSnapshot({ name: 'submit-button' })
    ).rejects.toThrow(nullScreenshotMessage);
    expect(mocks.transferScreenshot).not.toHaveBeenCalled();
  });

  it('fails a null screenshot under .not too', async () => {
    await expect(
      harnessExpect(null).not.toMatchImageSnapshot({ name: 'submit-button' })
    ).rejects.toThrow(nullScreenshotMessage);
    expect(mocks.transferScreenshot).not.toHaveBeenCalled();
  });
});
