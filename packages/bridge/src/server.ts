import { WebSocketServer, type WebSocket } from 'ws';
import { type BirpcGroup, createBirpcGroup } from 'birpc';
import { logger } from '@react-native-harness/tools';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BinaryStore, parseBinaryFrame } from './binary-transfer.js';
import type {
  BridgeServerFunctions,
  BridgeClientFunctions,
  DeviceDescriptor,
  BridgeEvents,
  ImageSnapshotOptions,
  HarnessContext,
  BinaryDataReference,
  FileReference,
} from './shared.js';
import { deserialize, serialize } from './serializer.js';
import { DeviceNotRespondingError } from './errors.js';
import { matchImageSnapshot } from './image-snapshot.js';

export { DeviceNotRespondingError } from './errors.js';

export type BridgeServerOptions = {
  port: number;
  timeout?: number;
  context: HarnessContext;
};

export type BridgeServerEvents = {
  ready: (device: DeviceDescriptor) => void;
  event: (event: BridgeEvents) => void;
  disconnect: () => void;
};

export type BridgeServer = {
  ws: WebSocketServer;
  rpc: BirpcGroup<BridgeClientFunctions, BridgeServerFunctions>;
  on: <T extends keyof BridgeServerEvents>(
    event: T,
    listener: BridgeServerEvents[T]
  ) => void;
  once: <T extends keyof BridgeServerEvents>(
    event: T,
    listener: BridgeServerEvents[T]
  ) => void;
  off: <T extends keyof BridgeServerEvents>(
    event: T,
    listener: BridgeServerEvents[T]
  ) => void;
  dispose: () => void;
};

export const getBridgeServer = async ({
  port,
  timeout,
  context,
}: BridgeServerOptions): Promise<BridgeServer> => {
  const wss = await new Promise<WebSocketServer>((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0' }, () => {
      resolve(server);
    });
  });
  const emitter = new EventEmitter();
  const clients = new Set<WebSocket>();
  const binaryStore = new BinaryStore();

  const baseFunctions: BridgeServerFunctions = {
    reportReady: (device) => {
      emitter.emit('ready', device);
    },
    emitEvent: (_, data) => {
      emitter.emit('event', data);
    },
    'device.screenshot.receive': async (
      reference: BinaryDataReference,
      metadata: { width: number; height: number }
    ) => {
      const data = binaryStore.get(reference.transferId);
      if (!data) {
        throw new Error(
          `Binary data for transfer ${reference.transferId} not found or expired`
        );
      }

      // Clean up from store
      binaryStore.delete(reference.transferId);

      // Write to temp file
      const tempFile = path.join(
        os.tmpdir(),
        `harness-screenshot-${randomUUID()}.png`
      );
      await fs.writeFile(tempFile, data);

      return {
        path: tempFile,
        width: metadata.width,
        height: metadata.height,
      };
    },
    'test.matchImageSnapshot': async (
      screenshot: FileReference,
      testPath: string,
      options: ImageSnapshotOptions
    ) => {
      return await matchImageSnapshot(
        screenshot,
        testPath,
        options,
        context.platform.name
      );
    },
  };

  const group = createBirpcGroup<BridgeClientFunctions, BridgeServerFunctions>(
    baseFunctions,
    [],
    {
      timeout,
      onFunctionError: (error, functionName, args) => {
        console.error('Function error', error, functionName, args);
        throw error;
      },
      onTimeoutError(functionName, args) {
        throw new DeviceNotRespondingError(functionName, args);
      },
    }
  );

  wss.on('connection', (ws: WebSocket) => {
    logger.debug('Client connected to the bridge');
    ws.on('close', () => {
      logger.debug('Client disconnected from the bridge');

      // TODO: Remove channel when connection is closed.
      clients.delete(ws);
      emitter.emit('disconnect');
    });

    group.updateChannels((channels) => {
      channels.push({
        post: (data) => ws.send(data),
        on: (handler) => {
          ws.on(
            'message',
            (event: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
              if (isBinary) {
                const uint8Array = new Uint8Array(event as any);
                try {
                  const { transferId, data } = parseBinaryFrame(uint8Array);
                  binaryStore.add(transferId, data);
                  return;
                } catch (error) {
                  logger.warn('Failed to parse binary frame', error);
                }
              }
              const message = event.toString();
              handler(message);
            }
          );
        },
        serialize,
        deserialize,
      });
    });
  });

  const dispose = () => {
    wss.close();
    emitter.removeAllListeners();
    binaryStore.dispose();
  };

  return {
    ws: wss,
    rpc: group,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    dispose,
  };
};
