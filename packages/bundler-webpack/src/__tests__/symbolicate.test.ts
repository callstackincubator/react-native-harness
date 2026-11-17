import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSymbolicate } from '../symbolicate.js';

let server: http.Server;

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (
  body: string,
  symbolicate: ReturnType<typeof vi.fn> = vi.fn(async (stack: unknown[]) => ({
    stack,
    codeFrame: null,
  }))
) => {
  server = http.createServer((request, response) => {
    void handleSymbolicate(request, response, symbolicate as never);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://localhost:${port}/symbolicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return { status: response.status, body: await response.json(), symbolicate };
};

describe('handleSymbolicate', () => {
  it('answers with what the symbolicator makes of the stack', async () => {
    const stack = [
      { methodName: 'fn', file: 'http://x/a.js', lineNumber: 1, column: 2 },
    ];
    const codeFrame = { content: 'frame', location: { row: 1, column: 2 }, fileName: '/a.ts' };

    const response = await post(
      JSON.stringify({ stack, extraData: {} }),
      vi.fn(async () => ({ stack, codeFrame }))
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stack, codeFrame });
    expect(response.symbolicate).toHaveBeenCalledWith(stack);
  });

  it('symbolicates an empty stack when the request names none', async () => {
    const response = await post('{}');

    expect(response.symbolicate).toHaveBeenCalledWith([]);
    expect(response.body).toEqual({ stack: [], codeFrame: null });
  });

  it('refuses a body that is not JSON', async () => {
    const response = await post('not json');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.symbolicate).not.toHaveBeenCalled();
  });

  it('reports a symbolicator that fails, as Metro does', async () => {
    const response = await post(
      '{"stack":[]}',
      vi.fn(async () => {
        throw new Error('no map');
      })
    );

    expect(response).toMatchObject({ status: 500, body: { error: 'no map' } });
  });
});
