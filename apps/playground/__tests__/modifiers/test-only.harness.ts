import { describe, test, expect } from 'react-native-harness';

describe('Test modifiers', () => {
  describe('test.only', () => {
    test('should throw if executed when another test has only', () => {
      throw new Error('This test should not run when another test has .only');
    });

    test.only('should be the only test to run', () => {
      expect(true).toBe(true);
    });

    test('should also throw if executed when another test has only', () => {
      throw new Error(
        'This test should also not run when another test has .only'
      );
    });
  });
});
