import { describe, expect, it, vi } from 'vitest';
import {
  createProcessResetStrategy,
  createRuntimeResetStrategy,
  resolveResetStrategyKind,
  withEscalation,
  type EnvironmentResetStrategy,
} from '../environment-reset.js';

describe('resolveResetStrategyKind', () => {
  it('normalizes true to the process strategy', () => {
    expect(resolveResetStrategyKind(true)).toBe('process');
  });

  it('normalizes false to null (no reset)', () => {
    expect(resolveResetStrategyKind(false)).toBeNull();
  });

  it('passes through the process string value', () => {
    expect(resolveResetStrategyKind('process')).toBe('process');
  });

  it('passes through the runtime string value', () => {
    expect(resolveResetStrategyKind('runtime')).toBe('runtime');
  });
});

describe('createProcessResetStrategy', () => {
  it('has kind "process" and delegates to the injected restart function', async () => {
    const restart = vi.fn(async () => undefined);
    const strategy = createProcessResetStrategy({ restart });

    expect(strategy.kind).toBe('process');
    await strategy.reset({ testFilePath: '/tests/example.harness.ts' });

    expect(restart).toHaveBeenCalledWith('/tests/example.harness.ts');
  });

  it('propagates restart failures', async () => {
    const restart = vi.fn(async () => {
      throw new Error('restart failed');
    });
    const strategy = createProcessResetStrategy({ restart });

    await expect(
      strategy.reset({ testFilePath: '/tests/example.harness.ts' })
    ).rejects.toThrow('restart failed');
  });
});

describe('createRuntimeResetStrategy', () => {
  const testFilePath = '/tests/example.harness.ts';

  it('has kind "runtime" and resets via the connection then waits for reconnect', async () => {
    const callOrder: string[] = [];
    const closeWindow = vi.fn();
    const connection = {
      resetEnvironment: vi.fn(async () => {
        callOrder.push('resetEnvironment');
      }),
    };
    const waitForReconnect = vi.fn(async () => {
      callOrder.push('waitForReconnect-started');
    });

    const strategy = createRuntimeResetStrategy({
      getConnection: () => connection,
      expectDisconnect: () => {
        callOrder.push('expectDisconnect');
        return closeWindow;
      },
      waitForReconnect,
      timeoutMs: 1000,
    });

    expect(strategy.kind).toBe('runtime');
    await strategy.reset({ testFilePath });

    expect(callOrder).toEqual([
      'expectDisconnect',
      'waitForReconnect-started',
      'resetEnvironment',
    ]);
    expect(waitForReconnect).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it('starts waiting for reconnect before firing the RPC', async () => {
    const callOrder: string[] = [];
    const connection = {
      resetEnvironment: vi.fn(async () => {
        callOrder.push('resetEnvironment');
      }),
    };
    const waitForReconnect = vi.fn(() => {
      callOrder.push('waitForReconnect-called');
      return Promise.resolve();
    });

    const strategy = createRuntimeResetStrategy({
      getConnection: () => connection,
      expectDisconnect: () => () => undefined,
      waitForReconnect,
      timeoutMs: 1000,
    });

    await strategy.reset({ testFilePath });

    expect(callOrder).toEqual(['waitForReconnect-called', 'resetEnvironment']);
  });

  it('throws when there is no active app connection', async () => {
    const expectDisconnect = vi.fn();
    const strategy = createRuntimeResetStrategy({
      getConnection: () => null,
      expectDisconnect,
      waitForReconnect: vi.fn(async () => undefined),
      timeoutMs: 1000,
    });

    await expect(strategy.reset({ testFilePath })).rejects.toThrow(
      'No active app connection'
    );
    expect(expectDisconnect).not.toHaveBeenCalled();
  });

  it('closes the expected-disconnect window even when the RPC call fails', async () => {
    const closeWindow = vi.fn();
    const connection = {
      resetEnvironment: vi.fn(async () => {
        throw new Error('rpc failed');
      }),
    };

    const strategy = createRuntimeResetStrategy({
      getConnection: () => connection,
      expectDisconnect: () => closeWindow,
      waitForReconnect: vi.fn(async () => undefined),
      timeoutMs: 1000,
    });

    await expect(strategy.reset({ testFilePath })).rejects.toThrow('rpc failed');
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it('closes the expected-disconnect window even when reconnect times out', async () => {
    const closeWindow = vi.fn();
    const connection = { resetEnvironment: vi.fn(async () => undefined) };

    const strategy = createRuntimeResetStrategy({
      getConnection: () => connection,
      expectDisconnect: () => closeWindow,
      waitForReconnect: vi.fn(async () => {
        throw new Error('reconnect timed out');
      }),
      timeoutMs: 1000,
    });

    await expect(strategy.reset({ testFilePath })).rejects.toThrow(
      'reconnect timed out'
    );
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});

describe('withEscalation', () => {
  const testFilePath = '/tests/example.harness.ts';

  const makeStrategy = (
    kind: EnvironmentResetStrategy['kind'],
    reset: EnvironmentResetStrategy['reset']
  ): EnvironmentResetStrategy => ({ kind, reset });

  it('reports the primary strategy kind', () => {
    const primary = makeStrategy('runtime', async () => undefined);
    const fallback = makeStrategy('process', async () => undefined);

    expect(withEscalation(primary, fallback).kind).toBe('runtime');
  });

  it('does not call the fallback when the primary succeeds', async () => {
    const fallbackReset = vi.fn(async () => undefined);
    const primary = makeStrategy('runtime', async () => undefined);
    const fallback = makeStrategy('process', fallbackReset);
    const onEscalate = vi.fn();

    await withEscalation(primary, fallback, { onEscalate }).reset({ testFilePath });

    expect(fallbackReset).not.toHaveBeenCalled();
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('escalates to the fallback when the primary fails', async () => {
    const primaryError = new Error('runtime reset failed');
    const fallbackReset = vi.fn(async () => undefined);
    const primary = makeStrategy('runtime', async () => {
      throw primaryError;
    });
    const fallback = makeStrategy('process', fallbackReset);
    const onEscalate = vi.fn();

    await withEscalation(primary, fallback, { onEscalate }).reset({ testFilePath });

    expect(fallbackReset).toHaveBeenCalledWith({ testFilePath });
    expect(onEscalate).toHaveBeenCalledWith(primaryError);
  });

  it('propagates the fallback error when both strategies fail', async () => {
    const fallbackError = new Error('process reset also failed');
    const primary = makeStrategy('runtime', async () => {
      throw new Error('runtime reset failed');
    });
    const fallback = makeStrategy('process', async () => {
      throw fallbackError;
    });

    await expect(
      withEscalation(primary, fallback).reset({ testFilePath })
    ).rejects.toBe(fallbackError);
  });
});
