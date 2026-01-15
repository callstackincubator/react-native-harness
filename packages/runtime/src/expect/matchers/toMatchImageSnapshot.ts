import { getClientInstance } from '../../client/store.js';
import type { MatcherState } from '@vitest/expect';
import {
  type ImageSnapshotOptions,
  generateTransferId,
} from '@react-native-harness/bridge';
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
  const client = getClientInstance();
  const context = getHarnessContext();

  const transferId = generateTransferId();
  client.sendBinary(transferId, received.data);

  const screenshotFile = await client.rpc['device.screenshot.receive'](
    {
      type: 'binary',
      transferId,
      size: received.data.length,
      mimeType: 'image/png',
    },
    {
      width: received.width,
      height: received.height,
    }
  );

  const result = await client.rpc['test.matchImageSnapshot'](
    screenshotFile,
    context.testFilePath,
    options,
    context.runner
  );

  return {
    pass: result.pass,
    message: () => result.message,
  };
}
