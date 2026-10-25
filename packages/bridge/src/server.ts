import { WebSocketServer, type WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '@react-native-harness/tools';
import { receiveBinary } from './binary.js';
import {
  AppBridgeDisconnectedError,
  DeviceNotRespondingError,
} from './errors.js';
import {
  createAppLiveness,
  resolveAppLivenessOptions,
  type AppLivenessOverrides,
} from './app-liveness.js';
import { matchImageSnapshot } from './image-snapshot.js';
import {
  createLink,
  globalClock,
  StandardWebSocketConnection,
  type LinkConnection,
  type StandardWebSocket,
} from './link/index.js';
import { serializeBridgeMessage } from './protocol.js';
import { createRpcPeer } from './rpc-peer.js';
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
export {
  DEFAULT_APP_LIVENESS_OPTIONS,
  type AppLivenessOverrides,
} from './app-liveness.js';

const bridgeLogger = logger.child('bridge');
const noop = (): void => undefined;

export type AppConnection = {
  readonly device: DeviceDescriptor;
  runTests: (path: string, options: TestExecutionOptions) => Promise<TestSuiteResult>;
  resetEnvironment: () => Promise<void>;
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
  /** Overrides for the connection check and JS watchdog limits. */
  liveness?: AppLivenessOverrides;
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
  link: LinkConnection,
  reference: BinaryDataReference,
): Promise<FileReference> => {
  const data = await receiveBinary(link, reference.channelId);

  if (data.length !== reference.size) {
    throw new Error(
      `Screenshot transfer ended after ${data.length} of ${reference.size} bytes`,
    );
  }

  const file = path.join(os.tmpdir(), `harness-screenshot-${randomUUID()}.png`);
  await fs.writeFile(file, data);
  return { path: file };
};

export const createHarnessBridge = async (
  options: HarnessBridgeOptions,
): Promise<HarnessBridge> => {
  const { timeout, context, liveness, ...transportOptions } = options;
  const livenessOptions = resolveAppLivenessOptions(liveness);
  const wss = await createWss(transportOptions);
  bridgeLogger.debug('bridge server ready');

  const emitter = new EventEmitter();
  // Screenshot files written by this bridge that have not been compared yet.
  const receivedScreenshots = new Set<string>();
  const removeScreenshot = (file: string) =>
    fs.rm(file, { force: true }).catch(() => undefined);
  let currentConnection: AppConnection | null = null;
  let activeSession: { disconnect: (reason?: Error) => void; link: LinkConnection } | null =
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
    const link = createLink(
      new StandardWebSocketConnection(ws as unknown as StandardWebSocket),
      {
        end: 'gateway',
        clock: globalClock,
        logger: bridgeLogger.child('link'),
      },
    );
    let readyConnection: AppConnection | null = null;
    let disconnected = false;
    let offMessage: () => void = noop;
    let offClose: () => void = noop;
    let offError: () => void = noop;

    const rpc = createRpcPeer<
      BridgeServerFunctions,
      BridgeClientFunctions,
      BridgeEvents
    >({
      localMethods: {
        'device.screenshot.receive': async (ref) => {
          const file = await receiveScreenshot(link, ref);
          receivedScreenshots.add(file.path);
          return file;
        },
        'test.matchImageSnapshot': async (screenshot, testPath, opts) => {
          try {
            return await matchImageSnapshot(
              screenshot,
              testPath,
              opts,
              context.platform.name,
            );
          } finally {
            // Only delete files this bridge created, never a client-supplied path.
            if (receivedScreenshots.delete(screenshot.path)) {
              await removeScreenshot(screenshot.path);
            }
          }
        },
      },
      transport: {
        send: (message) => {
          void link.write(message);
        },
      },
      onEvent: (event) => {
        appLiveness.handleEvent(event);
        emitter.emit('event', event);
      },
      callTimeoutMs: (method) => method === 'runTests' ? undefined : timeout,
      createTimeoutError: (functionName, args) => {
        return new DeviceNotRespondingError(functionName, args) as unknown as Error;
      },
    });

    const appLiveness = createAppLiveness({
      socket: ws,
      sendProbe: (id) => {
        void link.write(serializeBridgeMessage({ type: 'js-probe', id }));
      },
      onLost: (error) => {
        if (error.reason === 'connection-lost') {
          bridgeLogger.warn('app connection lost (no response to WebSocket ping)');
        } else {
          bridgeLogger.warn('app JS thread unresponsive: %s', error.detail);
        }

        disconnect(error);
        // Neither a half-open socket nor a blocked JS thread completes a
        // close handshake, so drop the socket instead of waiting for one.
        ws.terminate();
      },
      config: livenessOptions,
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
      appLiveness.dispose();

      if (activeSession?.link === link) {
        activeSession = null;
      }

      if (currentConnection === readyConnection) {
        currentConnection = null;
      }

      rpc.close(reason ?? new AppBridgeDisconnectedError('app-disconnected'));
      void link.close();

      if (readyConnection) {
        emitter.emit('disconnected');
      }
    };

    activeSession = { disconnect, link };

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
            resetEnvironment: () => rpc.invoke('resetEnvironment'),
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
        case 'js-probe-ack': {
          appLiveness.handleProbeAck(controlMessage.id);
          return;
        }
      }
    };

    offMessage = link.onData((message) => {
      void handleControlMessage(message).catch((error) => {
        bridgeLogger.warn('failed to handle bridge message: %s', error);
        disconnect(
          error instanceof Error
            ? error
            : new Error('Received invalid app bridge message'),
        );
      });
    });

    offError = link.onError((error) => {
      disconnect(
        error instanceof Error
          ? error
          : new AppBridgeDisconnectedError('socket-error'),
      );
    });

    offClose = link.onClose(() => {
      disconnect();
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

      for (const file of receivedScreenshots) {
        void removeScreenshot(file);
      }
      receivedScreenshots.clear();
    },
  };
};
