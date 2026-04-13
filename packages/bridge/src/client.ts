import { BirpcReturn, createBirpc } from 'birpc';
import type { BridgeClientFunctions, BridgeServerFunctions } from './shared.js';
import { deserialize, serialize } from './serializer.js';
import { createBinaryFrame } from './binary-transfer.js';

export type BridgeClient = {
  rpc: BirpcReturn<BridgeServerFunctions, BridgeClientFunctions>;
  disconnect: () => void;
  sendBinary: (transferId: number, data: Uint8Array) => void;
};

const getBridgeClient = async (
  url: string,
  handlers: BridgeClientFunctions,
): Promise<BridgeClient> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    let settled = false;

    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('close', handleClose);
    };

    const rejectConnection = (message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const handleOpen = () => {
      settled = true;
      cleanup();

      const rpc = createBirpc<BridgeServerFunctions, BridgeClientFunctions>(
        handlers,
        {
          post: (data) => ws.send(data),
          on: (handler) => {
            ws.addEventListener('message', (event: any) => {
              if (typeof event.data === 'string') {
                handler(event.data);
              }
            });
          },
          serialize,
          deserialize,
        },
      );

      const client: BridgeClient = {
        rpc,
        disconnect: () => {
          ws.close();
        },
        sendBinary: (transferId: number, data: Uint8Array) => {
          const frame = createBinaryFrame(transferId, data);
          ws.send(frame);
        },
      };

      resolve(client);
    };

    const handleError = (event: Event & { message?: string }) => {
      const reason =
        typeof event.message === 'string' && event.message.length > 0
          ? `: ${event.message}`
          : '';

      rejectConnection(
        `Failed to connect to the Harness bridge at ${url}${reason}`,
      );
    };

    const handleClose = (event: CloseEvent) => {
      rejectConnection(
        `Harness bridge connection to ${url} closed before it became ready (code ${event.code}${event.reason ? `, reason: ${event.reason}` : ''})`,
      );
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);
  });
};

export { getBridgeClient };
