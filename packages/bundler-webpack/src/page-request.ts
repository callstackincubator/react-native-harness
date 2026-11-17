import type { IncomingMessage } from 'node:http';

/**
 * Whether the request is the browser loading the page, wherever the project
 * serves it (`publicPath`, the HTML plugin's `filename`). Browsers say so with
 * `Sec-Fetch-Dest: document`; for a client that does not send it, a GET that
 * accepts HTML is taken for one.
 */
export const isPageRequest = (request: IncomingMessage): boolean => {
  if (request.method !== 'GET') {
    return false;
  }

  const destination = request.headers['sec-fetch-dest'];

  if (destination !== undefined) {
    return destination === 'document';
  }

  return (request.headers.accept ?? '').includes('text/html');
};
