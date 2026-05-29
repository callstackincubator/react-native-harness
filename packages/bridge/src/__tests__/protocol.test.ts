import { describe, expect, it } from 'vitest';
import {
  deserializeBridgeError,
  parseBridgeMessage,
  serializeBridgeError,
  serializeBridgeMessage,
} from '../protocol.js';

describe('bridge protocol', () => {
  it('round-trips invoke messages', () => {
    const raw = serializeBridgeMessage({
      type: 'invoke',
      id: 1,
      method: 'runTests',
      args: ['example.ts', { runner: '/runner.js' }],
    });

    expect(parseBridgeMessage(raw)).toEqual({
      type: 'invoke',
      id: 1,
      method: 'runTests',
      args: ['example.ts', { runner: '/runner.js' }],
    });
  });

  it('serializes and restores errors with metadata', () => {
    const cause = new Error('inner');
    const error = new TypeError('boom', { cause });
    error.stack = 'stack trace';

    const restored = deserializeBridgeError(serializeBridgeError(error));

    expect(restored.name).toBe('TypeError');
    expect(restored.message).toBe('boom');
    expect(restored.stack).toBe('stack trace');
    expect(restored.cause).toBe(cause);
  });

  it('serializes non-Error thrown values explicitly', () => {
    expect(serializeBridgeError('boom')).toEqual({
      name: 'NonErrorThrown',
      message: 'boom',
    });
  });

  it('rejects malformed messages', () => {
    expect(() => parseBridgeMessage('{"type":"invoke","id":"1"}')).toThrow(
      'Invalid bridge message: id must be a number',
    );
  });
});
