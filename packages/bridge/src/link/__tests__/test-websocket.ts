import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer } from "ws";

import type { UplinkTransportConnection } from "../ports.js";
import {
  connectStandardWebSocket,
  StandardWebSocketConnection,
  type StandardWebSocket,
} from "../standard-websocket.js";

// A real WebSocket pair over `ws`, both ends wrapped the way Harness wraps them.
export async function startWebSocketPair(): Promise<{
  worker: UplinkTransportConnection;
  gateway: UplinkTransportConnection;
  close(): Promise<void>;
}> {
  const sockets = new WebSocketServer({ noServer: true });
  let accepted: ((connection: UplinkTransportConnection) => void) | undefined;
  const acceptedConnection = new Promise<UplinkTransportConnection>((resolve) => {
    accepted = resolve;
  });
  const server: Server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (client) => {
      accepted?.(new StandardWebSocketConnection(client as unknown as StandardWebSocket));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const worker = await connectStandardWebSocket({
    createSocket: (url) => new WebSocket(url) as unknown as StandardWebSocket,
    url: `ws://127.0.0.1:${String(port)}`,
  });
  const gateway = await acceptedConnection;
  return {
    close: async () => {
      await worker.close();
      await gateway.close();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    gateway,
    worker,
  };
}
