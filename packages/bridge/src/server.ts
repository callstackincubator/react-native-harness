import { WebSocketServer, type WebSocket } from 'ws';
import { createBirpc, type BirpcReturn } from 'birpc';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '@react-native-harness/tools';
import { BinaryStore, parseBinaryFrame } from './binary-transfer.js';
import { deserialize, serialize } from './serializer.js';
import { DeviceNotRespondingError } from './errors.js';
import { matchImageSnapshot } from './image-snapshot.js';
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

export { DeviceNotRespondingError } from './errors.js';

const bridgeLogger = logger.child('bridge');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Represents a single app session — one app launch to the next restart.
 * Obtained via HarnessBridge.nextConnection().
 */
export type AppConnection = {
  readonly device: DeviceDescriptor;
  runTests: (path: string, options: TestExecutionOptions) => Promise<TestSuiteResult>;
};

export type HarnessBridgeEvents = {
  /** Fired when the app connects and calls reportReady. */
  connected: (connection: AppConnection) => void;
  /** Fired when the app's WebSocket closes. */
  disconnected: () => void;
  /** Fired for every test/bundler event the app emits. */
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

/**
 * The persistent CLI-side bridge. Spans the full test run regardless of how
 * many times the app is restarted. Each restart produces a new AppConnection
 * via nextConnection().
 */
export type HarnessBridge = {
  /** The underlying WebSocket server, used to attach to Metro's HTTP server. */
  readonly ws: WebSocketServer;
  /** The currently active app connection, null if the app is not connected. */
  readonly connection: AppConnection | null;
  /**
   * Resolves with the next AppConnection once the app connects and reports
   * ready. Register this waiter before restarting the app so no ready signal
   * is missed. Rejects if the supplied signal is aborted.
   */
  nextConnection: (signal?: AbortSignal) => Promise<AppConnection>;
  on: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => void;
  off: <T extends keyof HarnessBridgeEvents>(event: T, listener: HarnessBridgeEvents[T]) => void;
  dispose: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createHarnessBridge = async (
  options: HarnessBridgeOptions,
): Promise<HarnessBridge> => {
  const { timeout, context, ...transport } = options;
  const wss = await createWss(transport);
  bridgeLogger.debug('bridge server ready');

  const emitter = new EventEmitter();
  let currentConnection: AppConnection | null = null;
  const connectionWaiters: Array<{
    resolve: (c: AppConnection) => void;
    reject: (e: unknown) => void;
  }> = [];

  wss.on('connection', (ws: WebSocket) => {
    bridgeLogger.debug('app connected');
    const binaryStore = new BinaryStore();
    let readyConnection: AppConnection | null = null;
    let disconnected = false;

    const serverFunctions: BridgeServerFunctions = {
      reportReady: (device) => {
        const conn: AppConnection = {
          device,
          runTests: (testPath, opts) => rpc.runTests(testPath, opts),
        };
        readyConnection = conn;
        currentConnection = conn;
        bridgeLogger.debug(
          'app ready: platform=%s model=%s',
          device.platform,
          device.model,
        );
        emitter.emit('connected', conn);
        for (const { resolve } of connectionWaiters.splice(0)) resolve(conn);
      },
      emitEvent: (_, data) => {
        emitter.emit('event', data);
      },
      'device.screenshot.receive': (ref) => receiveScreenshot(binaryStore, ref),
      'test.matchImageSnapshot': (screenshot, testPath, opts) =>
        matchImageSnapshot(screenshot, testPath, opts, context.platform.name),
    };

    const rpc: BirpcReturn<BridgeClientFunctions, BridgeServerFunctions> = createBirpc<BridgeClientFunctions, BridgeServerFunctions>(
      serverFunctions,
      {
        post: (data) => ws.send(data),
        on: (handler) => {
          ws.on(
            'message',
            (msg: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
              if (isBinary) {
                try {
                  const messageBuffer = Array.isArray(msg)
                    ? Buffer.concat(msg)
                    : Buffer.isBuffer(msg)
                      ? msg
                      : Buffer.from(msg);
                  const { transferId, data } = parseBinaryFrame(
                    new Uint8Array(messageBuffer),
                  );
                  binaryStore.add(transferId, data);
                } catch (err) {
                  bridgeLogger.warn('failed to parse binary frame: %s', err);
                }
              } else {
                handler(msg.toString());
              }
            },
          );
        },
        serialize,
        deserialize,
        timeout,
        onFunctionError: (error, functionName, args) => {
          bridgeLogger.error(
            'rpc function failed: %s args=%o',
            functionName,
            args,
          );
          throw error;
        },
        onTimeoutError: (fn, args) => {
          throw new DeviceNotRespondingError(fn, args);
        },
      },
    );

    const disconnect = (reason?: Error) => {
      if (disconnected) return;
      disconnected = true;

      bridgeLogger.debug('app disconnected');
      binaryStore.dispose();
      if (currentConnection === readyConnection) {
        currentConnection = null;
      }
      rpc.$close(reason ?? new Error('App bridge disconnected'));
      emitter.emit('disconnected');
    };

    ws.on('close', () => {
      disconnect();
    });

    ws.on('error', (error) => {
      disconnect(error instanceof Error ? error : new Error('App bridge socket error'));
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
      // If the app already connected before this call (e.g. fast simulator
      // startup between startAttempt and waitForReady), return it immediately
      // rather than waiting for a second reportReady that will never come.
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
            if (idx !== -1) connectionWaiters.splice(idx, 1);
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
        reject(new Error('Bridge disposed'));
      }
      for (const client of wss.clients) client.terminate();
      wss.close();
      emitter.removeAllListeners();
    },
  };
};
