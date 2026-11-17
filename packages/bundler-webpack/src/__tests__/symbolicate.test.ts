import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { handleSymbolicate } from '../symbolicate.js';

let server: http.Server;

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (body: string) => {
  server = http.createServer((request, response) => {
    void handleSymbolicate(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://localhost:${port}/symbolicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return { status: response.status, body: await response.json() };
};

describe('handleSymbolicate', () => {
  it('answers in the shape Metro does, with no code frame', async () => {
    const stack = [
      { methodName: 'fn', file: 'http://x/a.js', lineNumber: 1, column: 2 },
    ];

    expect(await post(JSON.stringify({ stack }))).toEqual({
      status: 200,
      body: { stack, codeFrame: null },
    });
  });

  it('answers an empty stack when the request names none', async () => {
    expect(await post('{}')).toEqual({
      status: 200,
      body: { stack: [], codeFrame: null },
    });
  });

  it('refuses a body that is not JSON', async () => {
    const response = await post('not json');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
