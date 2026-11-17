import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetroPortRangeExhaustedError } from '../errors.js';
import { logMetroPortFallback } from '../logs.js';

const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex

describe('messages that name the bundler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('say Metro unless told otherwise, byte for byte as before', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logMetroPortFallback(8081, 8082);

    const output = strip(stderr.mock.calls.flat().join(''));
    expect(output).toContain('Harness could not use Metro port 8081 and is using 8082 instead.');
    expect(new MetroPortRangeExhaustedError(8081, 10).message).toBe(
      'Harness could not find an available Metro port in the range 8081-8090.'
    );
  });

  it('name the bundler that is running', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logMetroPortFallback(8081, 8082, 'Rspack');

    const output = strip(stderr.mock.calls.flat().join(''));
    expect(output).toContain('Harness could not use Rspack port 8081 and is using 8082 instead.');
    expect(new MetroPortRangeExhaustedError(8081, 10, 'webpack').message).toBe(
      'Harness could not find an available webpack port in the range 8081-8090.'
    );
  });
});
