import { describe, it, expect } from 'react-native-harness';

describe('Jest globals warning', () => {
  it('should throw when accessing jest global', () => {
    expect(() => {
      // @ts-expect-error - jest is not available in Harness tests
      jest.fn();
    }).toThrow('Jest globals are not available in Harness tests');
  });

  it('should throw when importing @jest/globals', () => {
    expect(() => require('@jest/globals')).toThrow(
      "Importing '@jest/globals' is not supported in Harness tests"
    );
  });
});
