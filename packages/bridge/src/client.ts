import { BirpcReturn, createBirpc } from 'birpc';
import type { BridgeClientFunctions, BridgeServerFunctions } from './shared.js';
import { deserialize, serialize } from './serializer.js';

export type BridgeClient = {
  rpc: BirpcReturn<BridgeServerFunctions, BridgeClientFunctions>;
  disconnect: () => void;
};

const getBridgeClient = async (
  url: string,
  handlers: BridgeClientFunctions
): Promise<BridgeClient> => {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);

    const handleOpen = () => {
      const rpc = createBirpc<BridgeServerFunctions, BridgeClientFunctions>(
        handlers,
        {
          post: (data) => ws.send(data),
          on: (handler) => {
            ws.addEventListener('message', (event: any) => {
              handler(event.data);
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
      };

      resolve(client);
    };

    ws.addEventListener('open', handleOpen, { once: true });
  });
};

export { getBridgeClient };
