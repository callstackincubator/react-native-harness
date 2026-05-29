export type BridgeTransportState = 'connecting' | 'open' | 'closing' | 'closed';

export type BridgeTransportMessage = string | Uint8Array;

export type BridgeTransportCloseEvent = {
  code: number;
  reason: string;
};

export type BridgeTransport = {
  readonly state: BridgeTransportState;
  send: (message: BridgeTransportMessage) => void;
  close: (code?: number, reason?: string) => void;
  onOpen: (listener: () => void) => () => void;
  onMessage: (listener: (message: BridgeTransportMessage) => void) => () => void;
  onClose: (listener: (event: BridgeTransportCloseEvent) => void) => () => void;
  onError: (listener: (error: Error) => void) => () => void;
};

export type RpcTransport = {
  readonly state: BridgeTransportState;
  send: (message: string) => void;
};

export const toTransportState = (readyState: number): BridgeTransportState => {
  switch (readyState) {
    case 0:
      return 'connecting';
    case 1:
      return 'open';
    case 2:
      return 'closing';
    default:
      return 'closed';
  }
};

export const createRpcTransport = (transport: BridgeTransport): RpcTransport => {
  return {
    get state() {
      return transport.state;
    },
    send: (message) => {
      transport.send(message);
    },
  };
};
