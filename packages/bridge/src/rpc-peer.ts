import {
  deserializeBridgeError,
  parseBridgeMessage,
  serializeBridgeError,
  serializeBridgeMessage,
  type BridgeControlMessage,
} from './protocol.js';
import type { RpcTransport } from './transport.js';

type RpcMethod = {
  bivarianceHack(...args: unknown[]): unknown;
}['bivarianceHack'];
type RpcMethods = Record<string, RpcMethod>;

type PendingInvocation = {
  args: unknown[];
  method: string;
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

export type RpcPeer<
  Remote extends RpcMethods,
  Event extends { type: string },
> = {
  invoke: <K extends keyof Remote>(
    method: K,
    ...args: Parameters<Remote[K]>
  ) => Promise<Awaited<ReturnType<Remote[K]>>>;
  sendEvent: (event: Event) => void;
  handleMessage: (raw: string) => Promise<BridgeControlMessage | null>;
  close: (reason?: Error) => void;
};

export type CreateRpcPeerOptions<
  Local extends RpcMethods,
  Event extends { type: string },
> = {
  localMethods: Local;
  transport: RpcTransport;
  onEvent?: (event: Event) => void;
  callTimeoutMs?: number;
  createTimeoutError?: (method: string, args: unknown[]) => Error;
};

const createClosedPeerError = (): Error => {
  return new Error('Bridge RPC peer closed');
};

export const createRpcPeer = <
  Local extends RpcMethods,
  Remote extends RpcMethods,
  Event extends { type: string },
>(
  options: CreateRpcPeerOptions<Local, Event>,
): RpcPeer<Remote, Event> => {
  const pendingInvocations = new Map<number, PendingInvocation>();
  let nextMessageId = 1;
  let closedReason: Error | null = null;

  const rejectPendingInvocations = (reason: Error) => {
    for (const [id, invocation] of pendingInvocations) {
      if (invocation.timeout) {
        clearTimeout(invocation.timeout);
      }

      pendingInvocations.delete(id);
      invocation.reject(reason);
    }
  };

  const close = (reason = createClosedPeerError()) => {
    if (closedReason) {
      return;
    }

    closedReason = reason;
    rejectPendingInvocations(reason);
  };

  const sendMessage = (message: object) => {
    if (closedReason) {
      throw closedReason;
    }

    options.transport.send(serializeBridgeMessage(message as never));
  };

  return {
    invoke: (method, ...args) => {
      if (closedReason) {
        return Promise.reject(closedReason);
      }

      const id = nextMessageId++;

      return new Promise((resolve, reject) => {
        const methodName = String(method);
        const invocation: PendingInvocation = {
          args,
          method: methodName,
          reject,
          resolve: (value) => {
            resolve(value as Awaited<ReturnType<Remote[typeof method]>>);
          },
          timeout: null,
        };

        if (options.callTimeoutMs !== undefined) {
          invocation.timeout = setTimeout(() => {
            pendingInvocations.delete(id);
            reject(
              options.createTimeoutError?.(methodName, args) ??
                new Error(`RPC call timed out: ${methodName}`),
            );
          }, options.callTimeoutMs);
        }

        pendingInvocations.set(id, invocation);

        try {
          sendMessage({
            type: 'invoke',
            id,
            method: methodName,
            args,
          });
        } catch (error) {
          pendingInvocations.delete(id);

          if (invocation.timeout) {
            clearTimeout(invocation.timeout);
          }

          reject(error);
        }
      });
    },
    sendEvent: (event) => {
      if (closedReason) {
        return;
      }

      try {
        sendMessage({ type: 'event', event });
      } catch (error) {
        close(error instanceof Error ? error : createClosedPeerError());
      }
    },
    handleMessage: async (raw) => {
      const message = parseBridgeMessage(raw);

      switch (message.type) {
        case 'invoke': {
          const localMethod = options.localMethods[message.method];

          if (!localMethod) {
            sendMessage({
              type: 'return',
              id: message.id,
              ok: false,
              error: serializeBridgeError(
                new Error(`Unknown bridge RPC method: ${message.method}`),
              ),
            });
            return null;
          }

          try {
            const value = await localMethod(...message.args);
            sendMessage({
              type: 'return',
              id: message.id,
              ok: true,
              value,
            });
          } catch (error) {
            sendMessage({
              type: 'return',
              id: message.id,
              ok: false,
              error: serializeBridgeError(error),
            });
          }

          return null;
        }
        case 'return': {
          const invocation = pendingInvocations.get(message.id);

          if (!invocation) {
            return null;
          }

          pendingInvocations.delete(message.id);

          if (invocation.timeout) {
            clearTimeout(invocation.timeout);
          }

          if (message.ok) {
            invocation.resolve(message.value);
          } else {
            invocation.reject(deserializeBridgeError(message.error));
          }

          return null;
        }
        case 'event': {
          options.onEvent?.(message.event as unknown as Event);
          return null;
        }
        case 'ready':
        case 'ping':
        case 'pong':
          return message;
      }
    },
    close,
  };
};
