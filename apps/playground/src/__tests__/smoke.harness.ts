import { describe, test, expect } from 'react-native-harness';

describe('Smoke test', () => {
  test('should run a simple test', () => {
    expect(1 + 1).toBe(2);
  });
});
