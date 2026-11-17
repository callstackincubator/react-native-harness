import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large');
    }

    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const send = (
  response: ServerResponse,
  status: number,
  body: unknown
): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
};

/**
 * Answers `POST /symbolicate` in the shape Metro uses: the stack, and a code
 * frame. The stack comes back as it came in and there is no code frame, so the
 * runtime reports a failure without one.
 */
export const handleSymbolicate = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  try {
    const { stack } = JSON.parse(await readBody(request)) as {
      stack?: unknown;
    };

    send(response, 200, {
      stack: Array.isArray(stack) ? stack : [],
      codeFrame: null,
    });
  } catch (error) {
    send(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
