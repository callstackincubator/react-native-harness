import { describe, test, expect } from 'react-native-harness';

describe('Setup files', () => {
  test('should execute setup file', () => {
    expect(global.SETUP_FILE_EXECUTED).toBe(true);
  });

  test('should execute setup file after env', () => {
    expect(global.SETUP_FILE_EXECUTED_AFTER_ENV).toBe(true);
  });
});
