import http from 'node:http';
import * as devicectl from './xcrun/devicectl.js';
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
  const agent = new http.Agent({ keepAlive: false });
  let hostPromise: Promise<string> | null = null;

  const getHost = (): Promise<string> => {
    if (!hostPromise) {
      hostPromise = devicectl.getDeviceHostname(options.deviceId);
    }
    return hostPromise;
  };

  return {
    request: async (
      request: XCTestAgentTransportRequest
    ): Promise<XCTestAgentTransportResponse> => {
      return await performHttpRequest({
        agent,
        body: request.body,
        host: await getHost(),
        method: request.method,
        path: request.path,
        port: options.port,
        timeoutMs,
      });
    },
    dispose: async () => {
      agent.destroy();
    },
  };
};

const performHttpRequest = async (options: {
  agent: http.Agent;
  body?: string;
  host: string;
  method: 'GET' | 'POST';
  path: string;
  port: number;
  timeoutMs: number;
}): Promise<XCTestAgentTransportResponse> => {
  return await new Promise<XCTestAgentTransportResponse>((resolve, reject) => {
    const request = http.request(
      {
        agent: options.agent,
        host: options.host,
        method: options.method,
        path: options.path,
        port: options.port,
        timeout: options.timeoutMs,
        headers: {
          ...(options.body === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(options.body, 'utf8'),
              }),
          connection: 'close',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });

        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: getResponseHeaders(response.headers),
          });
        });

        response.on('error', reject);
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(
          `Timed out waiting for XCTest agent response after ${options.timeoutMs}ms`
        )
      );
    });
    request.on('error', reject);

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
};

const getResponseHeaders = (
  headers: http.IncomingHttpHeaders
): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    values[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  return values;
};
