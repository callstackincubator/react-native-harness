import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isPageRequest } from '../page-request.js';

const request = (
  method: string,
  headers: Record<string, string> = {}
): IncomingMessage => ({ method, headers }) as unknown as IncomingMessage;

describe('isPageRequest', () => {
  it('is a navigation of the browser, whatever its path', () => {
    expect(isPageRequest(request('GET', { 'sec-fetch-dest': 'document' }))).toBe(true);
  });

  it('is not a script, a fetch or a frame', () => {
    for (const destination of ['script', 'empty', 'image', 'iframe']) {
      expect(isPageRequest(request('GET', { 'sec-fetch-dest': destination }))).toBe(false);
    }
  });

  it('trusts Sec-Fetch-Dest over Accept', () => {
    expect(
      isPageRequest(request('GET', { 'sec-fetch-dest': 'empty', accept: 'text/html' }))
    ).toBe(false);
  });

  it('falls back to Accept for a client that sends no Sec-Fetch-Dest', () => {
    expect(isPageRequest(request('GET', { accept: 'text/html,*/*' }))).toBe(true);
    expect(isPageRequest(request('GET', { accept: '*/*' }))).toBe(false);
    expect(isPageRequest(request('GET'))).toBe(false);
  });

  it('is a GET', () => {
    expect(isPageRequest(request('POST', { 'sec-fetch-dest': 'document' }))).toBe(false);
  });
});
