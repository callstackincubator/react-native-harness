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
  handlers: BridgeClientFunctions
): Promise<BridgeClient> => {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const handleOpen = () => {
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
        }
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

    ws.addEventListener('open', handleOpen, { once: true });
  });
};

export { getBridgeClient };
