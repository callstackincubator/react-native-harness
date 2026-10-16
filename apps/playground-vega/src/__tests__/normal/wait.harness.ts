import {
  describe,
  test,
  waitFor,
  waitUntil,
  expect,
} from 'react-native-harness';

describe('waitFor', () => {
  test('should resolve immediately when callback returns a value', async () => {
    const result = await waitFor(() => 'test value');
    expect(result).toBe('test value');
  });

  test('should wait for async callback to resolve', async () => {
    const result = await waitFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'async value';
    });
    expect(result).toBe('async value');
  });

  test('should retry until callback succeeds', async () => {
    let attempts = 0;
    const result = await waitFor(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Not ready yet');
      }
      return 'success';
    });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('should timeout when callback never succeeds', async () => {
    await expect(
      waitFor(
        () => {
          throw new Error('Always fails');
        },
        { timeout: 100 }
      )
    ).rejects.toThrow('Always fails');
  });

  test('should use custom interval and timeout options', async () => {
    const start = Date.now();
    let attempts = 0;

    const result = await waitFor(
      () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Not ready');
        }
        return 'done';
      },
      { interval: 20, timeout: 200 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe('done');
    expect(elapsed).toBeGreaterThanOrEqual(40); // At least 2 intervals
    expect(elapsed).toBeLessThan(200); // Should not timeout
  });

  test('should accept timeout as number shorthand', async () => {
    await expect(
      waitFor(() => {
        throw new Error('Always fails');
      }, 50) // timeout as number
    ).rejects.toThrow('Always fails');
  });
});

describe('waitUntil', () => {
  test('should resolve when callback returns truthy value', async () => {
    const result = await waitUntil(() => 'truthy value');
    expect(result).toBe('truthy value');
  });

  test('should wait until callback returns truthy value', async () => {
    let attempts = 0;
    const result = await waitUntil(() => {
      attempts++;
      return attempts >= 3 ? 'success' : false;
    });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('should handle async callback returning truthy value', async () => {
    let attempts = 0;
    const result = await waitUntil(async () => {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return attempts >= 2 ? 'async success' : null;
    });
    expect(result).toBe('async success');
    expect(attempts).toBe(2);
  });

  test('should timeout when callback never returns truthy value', async () => {
    await expect(waitUntil(() => false, { timeout: 100 })).rejects.toThrow(
      'Timed out in waitUntil!'
    );
  });

  test('should timeout when callback always returns falsy values', async () => {
    let attempts = 0;
    await expect(
      waitUntil(
        () => {
          attempts++;
          return attempts % 2 === 0 ? null : undefined; // Always falsy
        },
        { timeout: 100, interval: 20 }
      )
    ).rejects.toThrow('Timed out in waitUntil!');
  });

  test('should use custom interval and timeout options', async () => {
    const start = Date.now();
    let attempts = 0;

    const result = await waitUntil(
      () => {
        attempts++;
        return attempts >= 3 ? 'done' : '';
      },
      { interval: 25, timeout: 200 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe('done');
    expect(elapsed).toBeGreaterThanOrEqual(50); // At least 2 intervals
    expect(elapsed).toBeLessThan(200); // Should not timeout
  });

  test('should accept timeout as number shorthand', async () => {
    await expect(
      waitUntil(() => false, 50) // timeout as number
    ).rejects.toThrow('Timed out in waitUntil!');
  });

  test('should handle errors in callback', async () => {
    let attempts = 0;
    await expect(
      waitUntil(
        () => {
          attempts++;
          if (attempts < 5) {
            throw new Error('Callback error');
          }
          return true;
        },
        { timeout: 100, interval: 10 }
      )
    ).rejects.toThrow('Callback error');
  });

  test('should handle promise rejection in async callback', async () => {
    let attempts = 0;
    await expect(
      waitUntil(
        async () => {
          attempts++;
          if (attempts < 5) {
            throw new Error('Async callback error');
          }
          return true;
        },
        { timeout: 100, interval: 10 }
      )
    ).rejects.toThrow('Async callback error');
  });

  test('should distinguish between falsy values correctly', async () => {
    const falsyValues = [false, 0, '', null, undefined];
    let index = 0;

    const result = await waitUntil(() => {
      if (index < falsyValues.length) {
        return falsyValues[index++];
      }
      return 'finally truthy';
    });

    expect(result).toBe('finally truthy');
    expect(index).toBe(falsyValues.length);
  });
});
