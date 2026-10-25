import { Platform } from 'react-native';
import { describe, expect, test } from 'react-native-harness';

describe('Vega-only harness test', () => {
  test('reports the kepler platform', () => {
    // React Native for Vega reports "kepler", which is not part of the
    // upstream Platform.OS union.
    expect(Platform.OS as string).toBe('kepler');
  });
});
