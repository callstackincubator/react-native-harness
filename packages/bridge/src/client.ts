import { sendBinary } from './binary.js';
import {
  connectStandardWebSocket,
  createLink,
  globalClock,
  type LinkConnection,
  type Logger,
  type StandardWebSocket,
  type UplinkTransportConnection,
} from './link/index.js';
import { serializeBridgeMessage } from './protocol.js';
import { createRpcPeer } from './rpc-peer.js';
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
  resetEnvironment: () => Promise<void>;
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
  /** An already open link transport, used instead of dialing `url`. */
  transport?: UplinkTransportConnection;
  /** Creates the WebSocket to dial `url` with. Defaults to the global `WebSocket`. */
  createSocket?: (url: string) => StandardWebSocket;
};

export type { UplinkTransportConnection };

const noop = (): void => undefined;

const createConsoleLogger = (): Logger => {
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: (message) => console.warn(`[harness] ${message}`),
    error: (message) => console.error(`[harness] ${message}`),
    child: () => logger,
  };

  return logger;
};

// React Native has no `crypto.randomUUID`, so channel ids come from a counter. Ids only
// need to be unique among this connection's channels.
const createChannelIdGenerator = (): (() => string) => {
  let nextId = 1;
  return () => `app-${nextId++}`;
};

const dial = async (
  url: string,
  options: ConnectToHarnessOptions,
): Promise<UplinkTransportConnection> => {
  if (options.transport) {
    return options.transport;
  }

  try {
    return await connectStandardWebSocket({
      url,
      createSocket: options.createSocket,
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Failed to connect to Harness at ${url}${detail}`);
  }
};

export const connectToHarness = async (
  url: string,
  callbacks: HarnessCallbacks,
  options: ConnectToHarnessOptions = {},
): Promise<HarnessHandle> => {
  const transport = await dial(url, options);
  const link: LinkConnection = createLink(transport, {
    end: 'worker',
    clock: globalClock,
    logger: createConsoleLogger(),
    generateId: createChannelIdGenerator(),
  });

  const rpc = createRpcPeer<
    BridgeClientFunctions,
    BridgeServerFunctions,
    BridgeEvents
  >({
    localMethods: callbacks,
    transport: {
      send: (message) => {
        void link.write(message);
      },
    },
  });

  let peerClosed = false;
  let offMessage: () => void = noop;
  let offClose: () => void = noop;
  let offError: () => void = noop;

  const getLinkClosedError = () => {
    return new Error('Harness bridge link is closed');
  };

  const closePeer = (reason: Error) => {
    if (peerClosed) {
      return;
    }

    peerClosed = true;
    offMessage();
    offClose();
    offError();
    rpc.close(reason);
  };

  const handleMessage = async (data: string) => {
    const controlMessage = await rpc.handleMessage(data);

    if (!controlMessage) {
      return;
    }

    if (controlMessage.type === 'js-probe') {
      void link.write(
        serializeBridgeMessage({ type: 'js-probe-ack', id: controlMessage.id }),
      );
    }
  };

  offMessage = link.onData((message) => {
    void handleMessage(message).catch((error) => {
      closePeer(
        error instanceof Error
          ? error
          : new Error('Received invalid Harness bridge message'),
      );
      void link.close();
    });
  });

  offError = link.onError((error) => {
    closePeer(error);
  });

  offClose = link.onClose(() => {
    closePeer(new Error('Harness connection closed'));
  });

  return {
    reportReady: (device) => {
      if (link.closed) {
        closePeer(getLinkClosedError());
        return;
      }

      void link.write(serializeBridgeMessage({ type: 'ready', device }));
    },
    emitEvent: (event) => {
      rpc.sendEvent(event);
    },
    transferScreenshot: async (data, metadata) => {
      const binary = await sendBinary(link, data);

      try {
        const [file] = await Promise.all([
          rpc.invoke(
            'device.screenshot.receive',
            {
              type: 'binary',
              channelId: binary.channelId,
              size: data.length,
              mimeType: 'image/png',
            },
            metadata,
          ),
          binary.written,
        ]);

        return file;
      } catch (error) {
        binary.abort();
        throw error;
      }
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
      void link.close();
    },
  };
};
