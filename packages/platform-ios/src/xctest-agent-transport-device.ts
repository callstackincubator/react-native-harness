import { utilities } from 'appium-ios-device';
import type net from 'node:net';
import type {
  XCTestAgentTransport,
  XCTestAgentTransportRequest,
  XCTestAgentTransportResponse,
} from './xctest-agent-transport.js';

export const createDeviceXCTestAgentTransport = (options: {
  deviceId: string;
  port: number;
  timeoutMs?: number;
}): XCTestAgentTransport => {
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    request: async (
      request: XCTestAgentTransportRequest,
    ): Promise<XCTestAgentTransportResponse> => {
      const socket = (await utilities.connectPort(
        options.deviceId,
        options.port,
      )) as net.Socket;

      return await performSocketRequest(socket, request, timeoutMs);
    },
    dispose: async () => undefined,
  };
};

const performSocketRequest = async (
  socket: net.Socket,
  request: XCTestAgentTransportRequest,
  timeoutMs: number,
): Promise<XCTestAgentTransportResponse> => {
  return await new Promise<XCTestAgentTransportResponse>((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.setTimeout(timeoutMs, () => {
      finish(() => {
        reject(
          new Error(
            `Timed out waiting for XCTest agent response after ${timeoutMs}ms`,
          ),
        );
      });
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.on('end', () => {
      finish(() => {
        try {
          resolve(parseHttpResponse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });

    socket.on('error', (error) => {
      finish(() => {
        reject(error);
      });
    });

    socket.write(serializeHttpRequest(request));
    socket.end();
  });
};

const serializeHttpRequest = (request: XCTestAgentTransportRequest): string => {
  const body = request.body ?? '';
  const bodyLength = Buffer.byteLength(body, 'utf8');
  const headers = [
    `Host: localhost`,
    'Connection: close',
    'Accept: application/json',
  ];

  if (request.body !== undefined) {
    headers.push('Content-Type: application/json');
    headers.push(`Content-Length: ${bodyLength}`);
  }

  return [
    `${request.method} ${request.path} HTTP/1.1`,
    ...headers,
    '',
    body,
  ].join('\r\n');
};

const parseHttpResponse = (
  responseText: string,
): XCTestAgentTransportResponse => {
  const separatorIndex = responseText.indexOf('\r\n\r\n');

  if (separatorIndex === -1) {
    throw new Error(`Invalid XCTest agent HTTP response: ${responseText}`);
  }

  const rawHeaders = responseText.slice(0, separatorIndex).split('\r\n');
  const statusLine = rawHeaders.shift();

  if (!statusLine) {
    throw new Error('Missing XCTest agent HTTP status line');
  }

  const [, rawStatusCode] = statusLine.split(' ');
  const statusCode = Number(rawStatusCode);

  if (!Number.isFinite(statusCode)) {
    throw new Error(`Invalid XCTest agent HTTP status code: ${statusLine}`);
  }

  const headers: Record<string, string> = {};

  for (const header of rawHeaders) {
    const separator = header.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const name = header.slice(0, separator).trim().toLowerCase();
    const value = header.slice(separator + 1).trim();
    headers[name] = value;
  }

  return {
    statusCode,
    headers,
    body: responseText.slice(separatorIndex + 4),
  };
};
