import { describe, test, expect } from 'react-native-harness';

describe('Smoke test', () => {
  test('should run a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  test('should expose task context to tests', (context) => {
    expect(context).toBeDefined();
    expect(context.task.type).toBe('test');
    expect(context.task.mode).toBe('run');
    expect(context.task.file.name).toBe('src/__tests__/smoke.harness.ts');
    expect(context.task.suite.name).toBe('Smoke test');
    expect(context.task.name).toBe('should expose task context to tests');
  });

  test('should report dynamic skips as skipped', (context) => {
    context.skip('skip from test context');
  });
});
