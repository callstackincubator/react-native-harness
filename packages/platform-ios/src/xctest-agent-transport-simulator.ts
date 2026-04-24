import http from 'node:http';
import type {
  XCTestAgentTransport,
  XCTestAgentTransportRequest,
  XCTestAgentTransportResponse,
} from './xctest-agent-transport.js';

export const createSimulatorXCTestAgentTransport = (options: {
  host?: string;
  port: number;
}): XCTestAgentTransport => {
  const host = options.host ?? '127.0.0.1';
  const agent = new http.Agent({ keepAlive: false });

  return {
    request: async (
      request: XCTestAgentTransportRequest,
    ): Promise<XCTestAgentTransportResponse> => {
      return await performHttpRequest({
        agent,
        body: request.body,
        host,
        method: request.method,
        path: request.path,
        port: options.port,
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
}): Promise<XCTestAgentTransportResponse> => {
  return await new Promise<XCTestAgentTransportResponse>((resolve, reject) => {
    const request = http.request(
      {
        agent: options.agent,
        host: options.host,
        method: options.method,
        path: options.path,
        port: options.port,
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
      },
    );

    request.on('error', reject);

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
};

const getResponseHeaders = (
  headers: http.IncomingHttpHeaders,
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
