import { describe, expect, it, vi } from 'vitest';
import {
  createHarnessPluginManager,
  type HarnessPlugin,
} from '@react-native-harness/plugins';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { BridgeEvents } from '@react-native-harness/bridge';
import { createBundlerHookCaller } from '../bundler-hooks.js';
import { buildBridgeHookScheduler } from '../harness-session.js';
import { createHookQueue } from '../hook-queue.js';

describe('createBundlerHookCaller', () => {
  it('fires the metro hook and the bundler hook for Metro', async () => {
    const callHook = vi.fn(async () => undefined);
    const payload = { runId: 'run-1', port: 8081, host: undefined };

    await createBundlerHookCaller(callHook, 'metro')('initialized', payload);

    expect(callHook.mock.calls).toEqual([
      ['metro:initialized', payload],
      ['bundler:initialized', payload],
    ]);
  });

  it('fires only the bundler hook for any other bundler', async () => {
    const callHook = vi.fn(async () => undefined);
    const payload = {
      runId: 'run-1',
      target: 'module' as const,
      file: 'a.harness.ts',
      duration: 5,
    };

    await createBundlerHookCaller(callHook, 'webpack')(
      'bundle-finished',
      payload
    );

    expect(callHook.mock.calls).toEqual([['bundler:bundle-finished', payload]]);
  });

  it.each([
    ['bundle-started', { runId: 'r', target: 'module' as const, file: 'f' }],
    [
      'bundle-failed',
      {
        runId: 'r',
        target: 'setupFile' as const,
        file: 'f',
        setupType: 'setupFiles' as const,
        duration: 1,
        error: 'boom',
      },
    ],
    ['client-log', { runId: 'r', level: 'warn' as const, data: ['x'] }],
  ] as const)(
    'keeps the %s payload identical for both hooks',
    async (name, payload) => {
      const callHook = vi.fn(async () => undefined);

      await createBundlerHookCaller(callHook, 'metro')(name, payload as never);

      expect(callHook.mock.calls).toEqual([
        [`metro:${name}`, payload],
        [`bundler:${name}`, payload],
      ]);
    }
  );
});

describe('bridge events become bundler hooks', () => {
  const run = async (bundlerName: string) => {
    const calls: string[] = [];
    const plugin: HarnessPlugin<object, HarnessConfig, HarnessPlatform> = {
      name: 'recorder',
      hooks: {
        metro: {
          bundleFinished: (ctx) => void calls.push(`metro:${ctx.file}`),
        },
        bundler: {
          bundleFinished: (ctx) => void calls.push(`bundler:${ctx.file}`),
        },
      },
    };
    const pluginManager = createHarnessPluginManager<
      HarnessConfig,
      HarnessPlatform
    >({
      plugins: [plugin],
      projectRoot: '/project',
      config: {} as HarnessConfig,
      runner: { name: 'ios', platformId: 'ios' } as HarnessPlatform,
      abortSignal: new AbortController().signal,
    });
    const hooks = createHookQueue();
    const onEvent = buildBridgeHookScheduler(
      hooks,
      pluginManager,
      createBundlerHookCaller(pluginManager.callHook, bundlerName),
      () => 'run-1'
    );

    onEvent({
      type: 'module-bundling-finished',
      file: 'a.harness.ts',
      duration: 3,
    } as BridgeEvents);
    await hooks.drain();

    return calls;
  };

  it('fires metro:* and bundler:* for Metro', async () => {
    expect(await run('metro')).toEqual([
      'metro:a.harness.ts',
      'bundler:a.harness.ts',
    ]);
  });

  it('fires only bundler:* for another bundler', async () => {
    expect(await run('webpack')).toEqual(['bundler:a.harness.ts']);
  });
});
