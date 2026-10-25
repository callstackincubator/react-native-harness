import { describe, test, expect } from 'react-native-harness';

describe('Test modifiers', () => {
  describe('test.skip', () => {
    test('should run normally when not skipped', () => {
      expect(true).toBe(true);
    });

    test.skip('should throw if executed (but it should not execute)', () => {
      throw new Error('This test should not run because it is skipped');
    });

    test('should also run normally', () => {
      expect(true).toBe(true);
    });
  });
});

describe('Describe modifiers', () => {
  describe.skip('Skipped describe block', () => {
    test('should throw if executed (in skipped describe)', () => {
      throw new Error('This test should not run because describe is skipped');
    });

    test('should also throw if executed (in skipped describe)', () => {
      throw new Error(
        'This test should also not run because describe is skipped'
      );
    });
  });
});

describe('Mixed modifiers', () => {
  describe.skip('Skipped describe with mixed tests', () => {
    test('should throw if executed (normal test in skipped describe)', () => {
      throw new Error('This should not run because describe is skipped');
    });

    test.skip('should throw if executed (skipped test in skipped describe)', () => {
      throw new Error(
        'This should not run because both test and describe are skipped'
      );
    });
  });
});
