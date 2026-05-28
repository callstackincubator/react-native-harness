import {
  toTransportState,
  type BridgeTransport,
} from './transport.js';

type BrowserWebSocketLike = {
  readonly readyState: number;
  binaryType: BinaryType;
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: {
    (type: 'open', listener: () => void): void;
    (
      type: 'message',
      listener: (event: MessageEvent<string | ArrayBuffer>) => void,
    ): void;
    (type: 'close', listener: (event: CloseEvent) => void): void;
    (
      type: 'error',
      listener: (event: Event & { message?: string }) => void,
    ): void;
  };
  removeEventListener: {
    (type: 'open', listener: () => void): void;
    (
      type: 'message',
      listener: (event: MessageEvent<string | ArrayBuffer>) => void,
    ): void;
    (type: 'close', listener: (event: CloseEvent) => void): void;
    (
      type: 'error',
      listener: (event: Event & { message?: string }) => void,
    ): void;
  };
};

export const createWebSocketClientTransport = (url: string): BridgeTransport => {
  const socket = new WebSocket(url) as BrowserWebSocketLike;
  socket.binaryType = 'arraybuffer';

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
    onOpen: (listener) => {
      socket.addEventListener('open', listener);
      return () => socket.removeEventListener('open', listener);
    },
    onMessage: (listener) => {
      const handleMessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === 'string') {
          listener(event.data);
          return;
        }

        listener(new Uint8Array(event.data));
      };

      socket.addEventListener('message', handleMessage);
      return () => socket.removeEventListener('message', handleMessage);
    },
    onClose: (listener) => {
      const handleClose = (event: CloseEvent) => {
        listener({ code: event.code, reason: event.reason });
      };

      socket.addEventListener('close', handleClose);
      return () => socket.removeEventListener('close', handleClose);
    },
    onError: (listener) => {
      const handleError = (event: Event & { message?: string }) => {
        listener(new Error(event.message || 'Harness connection error'));
      };

      socket.addEventListener('error', handleError);
      return () => socket.removeEventListener('error', handleError);
    },
  };
};
