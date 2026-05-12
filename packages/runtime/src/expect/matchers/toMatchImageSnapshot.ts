import { getHandle } from '../../client/store.js';
import type { MatcherState } from '@vitest/expect';
import type { ImageSnapshotOptions } from '@react-native-harness/bridge';
import { getHarnessContext } from '../../runner/index.js';

type ScreenshotResult = {
  data: Uint8Array;
  width: number;
  height: number;
};

export async function toMatchImageSnapshot(
  this: MatcherState,
  received: ScreenshotResult,
  options: ImageSnapshotOptions
): Promise<{ pass: boolean; message: () => string }> {
  const handle = getHandle();
  const context = getHarnessContext();

  const screenshotFile = await handle.transferScreenshot(received.data, {
    width: received.width,
    height: received.height,
  });

  const result = await handle.matchImageSnapshot(
    screenshotFile,
    context.testFilePath,
    options,
    context.runner,
  );

  return {
    pass: result.pass,
    message: () => result.message,
  };
}
