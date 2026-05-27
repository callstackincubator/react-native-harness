import type { RawData, WebSocket as NodeWebSocket } from 'ws';
import {
  toTransportState,
  type BridgeTransport,
} from './transport.js';

const toUint8Array = (message: RawData): Uint8Array => {
  const buffer = Array.isArray(message)
    ? Buffer.concat(message)
    : Buffer.isBuffer(message)
      ? message
      : Buffer.from(message);

  return new Uint8Array(buffer);
};

export const createNodeWebSocketTransport = (
  socket: NodeWebSocket,
): BridgeTransport => {
  return {
    get state() {
      return toTransportState(socket.readyState);
    },
    send: (message) => {
      socket.send(message);
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
    onOpen: () => {
      return () => undefined;
    },
    onMessage: (listener) => {
      const handleMessage = (message: RawData, isBinary: boolean) => {
        listener(isBinary ? toUint8Array(message) : message.toString());
      };

      socket.on('message', handleMessage);
      return () => socket.off('message', handleMessage);
    },
    onClose: (listener) => {
      const handleClose = (code: number, reason: Buffer) => {
        listener({ code, reason: reason.toString() });
      };

      socket.on('close', handleClose);
      return () => socket.off('close', handleClose);
    },
    onError: (listener) => {
      socket.on('error', listener);
      return () => socket.off('error', listener);
    },
  };
};
