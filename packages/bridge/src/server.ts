import { WebSocketServer, type WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '@react-native-harness/tools';
import { BinaryStore, parseBinaryFrame } from './binary-transfer.js';
import {
  AppBridgeDisconnectedError,
  DeviceNotRespondingError,
} from './errors.js';
import { createHeartbeat } from './heartbeat.js';
import { matchImageSnapshot } from './image-snapshot.js';
import { serializeBridgeMessage } from './protocol.js';
import { createRpcPeer } from './rpc-peer.js';
import {
  createRpcTransport,
  type BridgeTransport,
} from './transport.js';
import { createNodeWebSocketTransport } from './websocket-server-transport.js';
import type {
  BridgeServerFunctions,
  BridgeClientFunctions,
  DeviceDescriptor,
  BridgeEvents,
  BinaryDataReference,
  FileReference,
  HarnessContext,
  TestExecutionOptions,
  TestSuiteResult,
} from './shared.js';

export {
  AppBridgeDisconnectedError,
  DeviceNotRespondingError,
} from './errors.js';

const bridgeLogger = logger.child('bridge');
const noop = (): void => undefined;

export type AppConnection = {
  readonly device: DeviceDescriptor;
  runTests: (path: string, options: TestExecutionOptions) => Promise<TestSuiteResult>;
};

export type HarnessBridgeEvents = {
  connected: (connection: AppConnection) => void;
  disconnected: () => void;
  event: (event: BridgeEvents) => void;
};

type TransportOptions =
  | { noServer: true }
  | { port: number; host?: string }
  | { server: HttpServer | HttpsServer; path?: string };

export type HarnessBridgeOptions = TransportOptions & {
  timeout?: number;
  context: HarnessContext;
};

export type HarnessBridge = {
  readonly ws: WebSocketServer;
  readonly connection: AppConnection | null;
  nextConnection: (signal?: AbortSignal) => Promise<AppConnection>;
  on: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => void;
  off: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => void;
  dispose: () => void;
};

const createWss = (transport: TransportOptions): Promise<WebSocketServer> => {
  if ('port' in transport) {
    return new Promise<WebSocketServer>((resolve) => {
      const wss: WebSocketServer = new WebSocketServer(
        { port: transport.port, host: transport.host ?? '0.0.0.0' },
        () => resolve(wss),
      );
    });
  }

  return Promise.resolve<WebSocketServer>(
    new WebSocketServer(
      'server' in transport
        ? { server: transport.server, path: transport.path }
        : { noServer: true },
    ),
  );
};

const receiveScreenshot = async (
  binaryStore: BinaryStore,
  reference: BinaryDataReference,
): Promise<FileReference> => {
  const data = binaryStore.get(reference.transferId);
  if (!data) {
    throw new Error(
      `Binary data for transfer ${reference.transferId} not found or expired`,
    );
  }

  binaryStore.delete(reference.transferId);
  const file = path.join(os.tmpdir(), `harness-screenshot-${randomUUID()}.png`);
  await fs.writeFile(file, data);
  return { path: file };
};

export const createHarnessBridge = async (
  options: HarnessBridgeOptions,
): Promise<HarnessBridge> => {
  const { timeout, context, ...transportOptions } = options;
  const wss = await createWss(transportOptions);
  bridgeLogger.debug('bridge server ready');

  const emitter = new EventEmitter();
  let currentConnection: AppConnection | null = null;
  let activeSession: { disconnect: (reason?: Error) => void; transport: BridgeTransport } | null =
    null;
  const connectionWaiters: Array<{
    resolve: (c: AppConnection) => void;
    reject: (e: unknown) => void;
  }> = [];

  wss.on('connection', (ws: WebSocket) => {
    if (activeSession) {
      bridgeLogger.info('replacing existing app connection with a newer client');
      activeSession.disconnect(new AppBridgeDisconnectedError('app-replaced'));
    }

    bridgeLogger.debug('app connected');
    const transport = createNodeWebSocketTransport(ws);
    const binaryStore = new BinaryStore();
    let readyConnection: AppConnection | null = null;
    let disconnected = false;
    let offMessage: () => void = noop;
    let offClose: () => void = noop;
    let offError: () => void = noop;

    const closeTransport = () => {
      if (transport.state === 'closing' || transport.state === 'closed') {
        return;
      }

      transport.close(1012);
    };

    const rpc = createRpcPeer<
      BridgeServerFunctions,
      BridgeClientFunctions,
      BridgeEvents
    >({
      localMethods: {
        'device.screenshot.receive': (ref) => receiveScreenshot(binaryStore, ref),
        'test.matchImageSnapshot': (screenshot, testPath, opts) =>
          matchImageSnapshot(screenshot, testPath, opts, context.platform.name),
      },
      transport: createRpcTransport(transport),
      onEvent: (event) => {
        emitter.emit('event', event);
      },
      callTimeoutMs: (method) => method === 'runTests' ? undefined : timeout,
      createTimeoutError: (functionName, args) => {
        return new DeviceNotRespondingError(functionName, args) as unknown as Error;
      },
    });

    const heartbeat = createHeartbeat({
      sendPing: (id) => {
        transport.send(serializeBridgeMessage({ type: 'ping', id }));
      },
      onTimeout: () => {
        bridgeLogger.warn('app heartbeat timed out');
        disconnect(new AppBridgeDisconnectedError('heartbeat-timeout'));
      },
    });

    const disconnect = (reason?: Error) => {
      if (disconnected) {
        return;
      }

      disconnected = true;
      offMessage();
      offClose();
      offError();
      bridgeLogger.debug('app disconnected');
      heartbeat.dispose();
      binaryStore.dispose();

      if (activeSession?.transport === transport) {
        activeSession = null;
      }

      if (currentConnection === readyConnection) {
        currentConnection = null;
      }

      rpc.close(reason ?? new AppBridgeDisconnectedError('app-disconnected'));
      closeTransport();

      if (readyConnection) {
        emitter.emit('disconnected');
      }
    };

    activeSession = { disconnect, transport };

    const handleControlMessage = async (message: string) => {
      const controlMessage = await rpc.handleMessage(message);

      if (!controlMessage) {
        return;
      }

      switch (controlMessage.type) {
        case 'ready': {
          if (readyConnection) {
            return;
          }

          const conn: AppConnection = {
            device: controlMessage.device,
            runTests: (testPath, opts) => rpc.invoke('runTests', testPath, opts),
          };

          readyConnection = conn;
          currentConnection = conn;
          bridgeLogger.debug(
            'app ready: platform=%s model=%s',
            controlMessage.device.platform,
            controlMessage.device.model,
          );
          emitter.emit('connected', conn);

          for (const { resolve } of connectionWaiters.splice(0)) {
            resolve(conn);
          }
          return;
        }
        case 'ping': {
          transport.send(
            serializeBridgeMessage({ type: 'pong', id: controlMessage.id }),
          );
          return;
        }
        case 'pong': {
          heartbeat.notifyPong(controlMessage.id);
          return;
        }
      }
    };

    const handleBinaryMessage = (message: Uint8Array) => {
      try {
        const { transferId, data } = parseBinaryFrame(message);
        binaryStore.add(transferId, data);
      } catch (error) {
        bridgeLogger.warn('failed to parse binary frame: %s', error);
      }
    };

    offMessage = transport.onMessage((message) => {
      if (typeof message !== 'string') {
        handleBinaryMessage(message);
        return;
      }

      void handleControlMessage(message).catch((error) => {
        bridgeLogger.warn('failed to handle bridge message: %s', error);
        disconnect(
          error instanceof Error
            ? error
            : new Error('Received invalid app bridge message'),
        );
      });
    });

    offClose = transport.onClose(() => {
      disconnect();
    });

    offError = transport.onError((error) => {
      disconnect(
        error instanceof Error
          ? error
          : new AppBridgeDisconnectedError('socket-error'),
      );
    });
  });

  return {
    get ws() {
      return wss;
    },
    get connection() {
      return currentConnection;
    },
    nextConnection: (signal) => {
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ?? new DOMException('Aborted', 'AbortError'),
        );
      }

      if (currentConnection) {
        return Promise.resolve(currentConnection);
      }

      return new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        connectionWaiters.push(entry);
        signal?.addEventListener(
          'abort',
          () => {
            const idx = connectionWaiters.indexOf(entry);
            if (idx !== -1) {
              connectionWaiters.splice(idx, 1);
            }

            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    dispose: () => {
      bridgeLogger.debug('disposing bridge');

      for (const { reject } of connectionWaiters.splice(0)) {
        reject(new AppBridgeDisconnectedError('bridge-disposed'));
      }

      activeSession?.disconnect(new AppBridgeDisconnectedError('bridge-disposed'));

      for (const client of wss.clients) {
        client.terminate();
      }

      wss.close();
      emitter.removeAllListeners();
    },
  };
};
