import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StackFrame, SymbolicatedStack } from './symbolicate-stack.js';

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
 * Answers `POST /symbolicate` in the shape Metro uses: the stack with each
 * frame mapped to its original file, and a code frame. `symbolicate` does the
 * mapping, against the compilation the page was loaded from.
 */
export const handleSymbolicate = async (
  request: IncomingMessage,
  response: ServerResponse,
  symbolicate: (stack: StackFrame[]) => Promise<SymbolicatedStack>
): Promise<void> => {
  let stack: StackFrame[];

  try {
    const body = JSON.parse(await readBody(request)) as { stack?: unknown };
    stack = Array.isArray(body.stack) ? (body.stack as StackFrame[]) : [];
  } catch (error) {
    send(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    send(response, 200, await symbolicate(stack));
  } catch (error) {
    send(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
