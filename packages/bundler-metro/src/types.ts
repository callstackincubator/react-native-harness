import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import type { Reporter } from './reporter.js';
import type { Config as HarnessConfig } from '@react-native-harness/config';

export type MetroWebSocketEndpoint = {
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    upgradeHead: Buffer,
    callback: (client: unknown, request: IncomingMessage) => void
  ) => void;
  emit: (event: 'connection', client: unknown, request: IncomingMessage) => void;
};

export type MetroOptions = {
  projectRoot: string;
  harnessConfig: HarnessConfig;
  websocketEndpoints?: Record<string, MetroWebSocketEndpoint>;
};

export type MetroInstance = {
  events: Reporter;
  httpServer: HttpServer | HttpsServer;
  websocketEndpoints: Record<string, MetroWebSocketEndpoint>;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
