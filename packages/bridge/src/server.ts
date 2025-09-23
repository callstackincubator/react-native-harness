import { WebSocketServer, type WebSocket } from 'ws';
import { type BirpcGroup, createBirpcGroup } from 'birpc';
import { logger } from '@react-native-harness/tools';
import { EventEmitter } from 'node:events';
import type {
  BridgeServerFunctions,
  BridgeClientFunctions,
  DeviceDescriptor,
  BridgeEventsMap,
} from './shared.js';
import { deserialize, serialize } from './serializer.js';

export type BridgeServerOptions = {
  port: number;
};

export type BridgeServerEvents = {
  ready: (device: DeviceDescriptor) => void;
} & BridgeEventsMap;

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
      reportReady: (device) => {
        emitter.emit('ready', device);
      },
      emitEvent: (event, data) => {
        emitter.emit(event, data);
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
        serialize,
        deserialize,
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
