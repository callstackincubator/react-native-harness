import { describe, test, expect } from 'react-native-harness';

describe('Smoke test', () => {
  test('should run a simple test', () => {
    console.log('Hello, world!');
    console.warn('This is a warning!');
    console.error('This is an error!');
    console.info('This is an info!');
    console.debug('This is a debug!');
    expect(1 + 1).toBe(2);
  });
});
