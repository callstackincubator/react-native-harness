import { createBinaryFrame, generateTransferId } from './binary-transfer.js';
import { serializeBridgeMessage } from './protocol.js';
import { createRpcPeer } from './rpc-peer.js';
import {
  createRpcTransport,
  type BridgeTransport,
} from './transport.js';
import { createWebSocketClientTransport } from './websocket-client-transport.js';
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

export type HarnessCallbacks = {
  runTests: (path: string, options: TestExecutionOptions) => Promise<TestSuiteResult>;
};

export type HarnessHandle = {
  reportReady: (device: DeviceDescriptor) => void;
  emitEvent: (event: BridgeEvents) => void;
  transferScreenshot: (
    data: Uint8Array,
    metadata: { width: number; height: number },
  ) => Promise<FileReference>;
  matchImageSnapshot: (
    screenshot: FileReference,
    testPath: string,
    options: ImageSnapshotOptions,
    runner: string,
  ) => Promise<{ pass: boolean; message: string }>;
  disconnect: () => void;
};

export type ConnectToHarnessOptions = {
  transport?: BridgeTransport;
};

export { createWebSocketClientTransport };

const noop = (): void => undefined;

export const connectToHarness = (
  url: string,
  callbacks: HarnessCallbacks,
  options: ConnectToHarnessOptions = {},
): Promise<HarnessHandle> =>
  new Promise((resolve, reject) => {
    const transport = options.transport ?? createWebSocketClientTransport(url);
    let settled = false;
    let peerClosed = false;
    let offOpen: () => void = noop;
    let offError: () => void = noop;
    let offClose: () => void = noop;

    const cleanup = () => {
      offOpen();
      offError();
      offClose();
    };

    const fail = (message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const handleOpen = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      const getTransportNotOpenError = () => {
        return new Error('Harness bridge transport is not open');
      };

      const rpc = createRpcPeer<
        BridgeClientFunctions,
        BridgeServerFunctions,
        BridgeEvents
      >({
        localMethods: callbacks,
        transport: createRpcTransport(transport),
      });

      let offMessage: () => void = noop;
      let offRuntimeClose: () => void = noop;
      let offRuntimeError: () => void = noop;

      const closePeer = (reason: Error) => {
        if (peerClosed) {
          return;
        }

        peerClosed = true;
        offMessage();
        offRuntimeClose();
        offRuntimeError();
        rpc.close(reason);
      };

      const handleMessage = async (data: string) => {
        const controlMessage = await rpc.handleMessage(data);

        if (!controlMessage) {
          return;
        }

        if (controlMessage.type === 'ping') {
          transport.send(
            serializeBridgeMessage({ type: 'pong', id: controlMessage.id }),
          );
        }
      };

      offMessage = transport.onMessage((message) => {
        if (typeof message !== 'string') {
          return;
        }

        void handleMessage(message).catch((error) => {
          closePeer(
            error instanceof Error
              ? error
              : new Error('Received invalid Harness bridge message'),
          );

          if (transport.state === 'open') {
            transport.close(1002, 'Invalid message');
          }
        });
      });

      offRuntimeClose = transport.onClose((event) => {
        closePeer(
          new Error(
            `Harness connection closed (code ${event.code}${
              event.reason ? `, reason: ${event.reason}` : ''
            })`,
          ),
        );
      });

      offRuntimeError = transport.onError((error) => {
        closePeer(error);
      });

      resolve({
        reportReady: (device) => {
          try {
            if (transport.state !== 'open') {
              throw getTransportNotOpenError();
            }

            transport.send(serializeBridgeMessage({ type: 'ready', device }));
          } catch (error) {
            closePeer(
              error instanceof Error ? error : getTransportNotOpenError(),
            );
          }
        },
        emitEvent: (event) => {
          rpc.sendEvent(event);
        },
        transferScreenshot: async (data, metadata) => {
          const transferId = generateTransferId();
          transport.send(createBinaryFrame(transferId, data));
          return rpc.invoke(
            'device.screenshot.receive',
            { type: 'binary', transferId, size: data.length, mimeType: 'image/png' },
            metadata,
          );
        },
        matchImageSnapshot: (screenshot, testPath, options, runner) =>
          rpc.invoke(
            'test.matchImageSnapshot',
            screenshot,
            testPath,
            options,
            runner,
          ),
        disconnect: () => {
          closePeer(new Error('Harness connection closed by client'));
          transport.close();
        },
      });
    };

    const handleError = (error: Error) => {
      const detail = error.message ? `: ${error.message}` : '';
      fail(`Failed to connect to Harness at ${url}${detail}`);
    };

    const handleClose = (event: { code: number; reason: string }) => {
      fail(
        `Harness connection at ${url} closed before becoming ready (code ${event.code}${
          event.reason ? `, reason: ${event.reason}` : ''
        })`,
      );
    };

    offOpen = transport.onOpen(handleOpen);
    offError = transport.onError(handleError);
    offClose = transport.onClose(handleClose);

    if (transport.state === 'open') {
      handleOpen();
    }
  });
