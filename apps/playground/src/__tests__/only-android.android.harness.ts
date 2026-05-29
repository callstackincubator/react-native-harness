import { Platform } from 'react-native';
import { describe, expect, test } from 'react-native-harness';

describe('Android-only harness test', () => {
  test('reports android platform', () => {
    expect(Platform.OS).toBe('android');
  });
});
