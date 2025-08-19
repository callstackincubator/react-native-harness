import { WebSocketServer, type WebSocket } from 'ws';
import { type BirpcGroup, createBirpcGroup } from 'birpc';
import { logger } from '@react-native-harness/tools';
import { EventEmitter } from 'node:events';
import type { BridgeServerFunctions, BridgeClientFunctions } from './shared.js';

export type BridgeServerOptions = {
  port: number;
};

export type BridgeServerEvents = {
  ready: () => void;
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
};

export const getBridgeServer = async ({
  port,
}: BridgeServerOptions): Promise<BridgeServer> => {
  const wss = await new Promise<WebSocketServer>((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0' }, () => {
      resolve(server);
    });
  });
  const emitter = new EventEmitter();
  const clients = new Set<WebSocket>();

  const group = createBirpcGroup<BridgeClientFunctions, BridgeServerFunctions>(
    {
      reportReady: () => {
        emitter.emit('ready', '');
      },
    } satisfies BridgeServerFunctions,
    []
  );

  wss.on('connection', (ws: WebSocket) => {
    logger.debug('Client connected to the bridge');
    ws.on('close', () => {
      logger.debug('Client disconnected from the bridge');

      // TODO: Remove channel when connection is closed.
      clients.delete(ws);
    });

    group.updateChannels((channels) => {
      channels.push({
        post: (data) => ws.send(data),
        on: (handler) => {
          ws.on('message', (event: Buffer | ArrayBuffer | Buffer[]) => {
            const message = event.toString();
            handler(message);
          });
        },
        serialize: (data) => {
          if (data.e) {
            // Serialize error by hand (include message, stack and cause).
            return JSON.stringify({
              ...data,
              e: {
                ...data.e,
                name: data.e.name,
                message: data.e.message,
                stack: data.e.stack,
                cause: data.e.cause,
              },
            });
          }

          return JSON.stringify(data);
        },
        deserialize: JSON.parse,
      });
    });
  });

  return {
    ws: wss,
    rpc: group,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
  };
};
