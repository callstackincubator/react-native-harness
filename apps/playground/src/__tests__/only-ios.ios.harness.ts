import { Platform } from 'react-native';
import { describe, expect, test } from 'react-native-harness';

describe('iOS-only harness test', () => {
  test('reports ios platform', () => {
    expect(Platform.OS).toBe('ios');
  });
});
