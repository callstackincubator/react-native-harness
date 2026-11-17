import { describe, it, expect } from 'react-native-harness';

describe('setup files', () => {
  it('runs setupFiles', () => {
    expect(global.SETUP_FILE_EXECUTED).toBe(true);
  });

  it('runs setupFilesAfterEnv, which imports through the @app alias', () => {
    expect(global.SETUP_FILE_EXECUTED_AFTER_ENV).toBe(true);
  });
});
