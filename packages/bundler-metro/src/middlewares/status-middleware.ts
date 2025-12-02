import type { IncomingMessage, ServerResponse } from 'node:http';

export const getStatusMiddleware =
  (projectRoot: string) => (_: IncomingMessage, res: ServerResponse) => {
    res.setHeader(
      'X-React-Native-Project-Root',
      new URL(`file:///${projectRoot}`).pathname.slice(1)
    );
    res.end('packager-status:running');
  };
