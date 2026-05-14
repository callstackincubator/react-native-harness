import { createBirpc } from 'birpc';
import { deserialize, serialize } from './serializer.js';
import { createBinaryFrame, generateTransferId } from './binary-transfer.js';
import type {
  BridgeClientFunctions,
  BridgeServerFunctions,
  DeviceDescriptor,
  BridgeEvents,
  FileReference,
  ImageSnapshotOptions,
  TestExecutionOptions,
  TestSuiteResult,
} from './shared.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Handlers the app must implement for the CLI to call into. */
export type HarnessCallbacks = {
  runTests: (path: string, options: TestExecutionOptions) => Promise<TestSuiteResult>;
};

/** The app-side handle returned by connectToHarness. */
export type HarnessHandle = {
  /** Call once when the app is initialised and ready to run tests. */
  reportReady: (device: DeviceDescriptor) => void;
  /** Forward a test or bundler event to the CLI. */
  emitEvent: (event: BridgeEvents) => void;
  /** Send a screenshot to the CLI and receive a file reference for snapshot comparison. */
  transferScreenshot: (
    data: Uint8Array,
    metadata: { width: number; height: number },
  ) => Promise<FileReference>;
  /** Request an image snapshot comparison on the CLI. */
  matchImageSnapshot: (
    screenshot: FileReference,
    testPath: string,
    options: ImageSnapshotOptions,
    runner: string,
  ) => Promise<{ pass: boolean; message: string }>;
  disconnect: () => void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Connect the app to the CLI harness bridge.
 *
 * Pass the handlers the CLI can call (runTests). Returns a HarnessHandle
 * exposing the operations the app needs to drive a test run. The binary
 * transfer protocol and RPC wiring are fully encapsulated.
 */
export const connectToHarness = (
  url: string,
  callbacks: HarnessCallbacks,
): Promise<HarnessHandle> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    let settled = false;

    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('close', handleClose);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const handleOpen = () => {
      settled = true;
      cleanup();

      const rpc = createBirpc<BridgeServerFunctions, BridgeClientFunctions>(
        callbacks,
        {
          post: (data) => ws.send(data),
          on: (handler) => {
            ws.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
              if (typeof event.data === 'string') handler(event.data);
            });
          },
          serialize,
          deserialize,
        },
      );

      resolve({
        reportReady: (device) => void rpc.reportReady(device),
        emitEvent: (event) => void rpc.emitEvent(event.type, event),
        transferScreenshot: async (data, metadata) => {
          const transferId = generateTransferId();
          ws.send(createBinaryFrame(transferId, data));
          return rpc['device.screenshot.receive'](
            { type: 'binary', transferId, size: data.length, mimeType: 'image/png' },
            metadata,
          );
        },
        matchImageSnapshot: (screenshot, testPath, options, runner) =>
          rpc['test.matchImageSnapshot'](screenshot, testPath, options, runner),
        disconnect: () => ws.close(),
      });
    };

    const handleError = (event: Event & { message?: string }) => {
      const detail =
        typeof event.message === 'string' && event.message
          ? `: ${event.message}`
          : '';
      fail(`Failed to connect to Harness at ${url}${detail}`);
    };

    const handleClose = (event: CloseEvent) => {
      fail(
        `Harness connection at ${url} closed before becoming ready (code ${event.code}${
          event.reason ? `, reason: ${event.reason}` : ''
        })`,
      );
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);
  });
