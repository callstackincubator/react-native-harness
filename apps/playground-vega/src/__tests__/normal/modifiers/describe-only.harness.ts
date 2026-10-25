import { describe, test, expect } from 'react-native-harness';

describe('Describe modifiers', () => {
  describe.only('Only this describe block should run', () => {
    test('test inside only describe block', () => {
      expect(true).toBe(true);
    });

    test('another test in only describe block', () => {
      expect(true).toBe(true);
    });
  });

  describe('This describe should not run due to only above', () => {
    test('should throw if executed', () => {
      throw new Error(
        'This describe block should not run when another has .only'
      );
    });
  });
});
