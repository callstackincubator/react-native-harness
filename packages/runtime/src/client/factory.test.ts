import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from './factory.js';
import { getEmitter } from '../utils/emitter.js';
import { installHost, type Host } from '../host.js';
import {
  installModuleSystem,
  type ModuleSystem,
} from '../module-system.js';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  handlers: undefined as
    | undefined
    | {
        resetEnvironment: () => Promise<void>;
        runTests: (path: string, options: object) => Promise<unknown>;
      },
}));

vi.mock('react-native', () => ({
  View: 'View',
  Platform: { OS: 'ios' },
}));

vi.mock('@react-native-harness/bridge/client', () => ({
  connectToHarness: vi.fn(async (_url: string, handlers: unknown) => {
    mocks.handlers = handlers as typeof mocks.handlers;
    return {
      emitEvent: (event: { type: string }) => {
        mocks.order.push(`event:${event.type}`);
      },
    };
  }),
}));

vi.mock('../promise-tracker.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../promise-tracker.js')>()),
  installPromiseTracker: vi.fn(),
}));

vi.mock('../render/setup.js', () => ({
  setup: () => {
    mocks.order.push('setup');
  },
}));

vi.mock('../collector/index.js', () => ({
  getTestCollector: () => ({
    events: getEmitter(),
    collect: async (run: () => Promise<void>) => {
      mocks.order.push('collect:start');
      await run();
      mocks.order.push('collect:end');
      return { testSuite: {} };
    },
    dispose: vi.fn(),
  }),
}));

vi.mock('../runner/index.js', () => ({
  getTestRunner: () => ({
    events: getEmitter(),
    run: async () => {
      mocks.order.push('runner:run');
      return {};
    },
    dispose: vi.fn(),
  }),
}));

const reloadRuntime = vi.fn();

const installFakes = (failLoading?: string) => {
  const moduleSystem: ModuleSystem = {
    loadModule: async (filePath) => {
      mocks.order.push(`load:${filePath}`);
      if (filePath === failLoading) {
        throw new Error('nope');
      }
      return {
        run: async () => {
          mocks.order.push(`run:${filePath}`);
        },
      };
    },
    releaseModule: async (filePath) => {
      mocks.order.push(`release:${filePath}`);
    },
    createMockRegistry: vi.fn(),
  };
  installModuleSystem(moduleSystem);
  installHost({
    getDevServerUrl: () => 'http://localhost:8081/',
    reloadRuntime,
  } as unknown as Host);
};

const runTests = async () => {
  await getClient();
  return mocks.handlers?.runTests('test.harness.ts', {
    setupFiles: ['setup.ts'],
    setupFilesAfterEnv: ['after-env.ts'],
  });
};

describe('running a test file through the installed module system', () => {
  beforeEach(() => {
    mocks.order.length = 0;
    reloadRuntime.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads and runs setup files and the test file in order and releases the file', async () => {
    installFakes();

    await runTests();

    expect(mocks.order).toEqual([
      'event:setup-file-bundling-started',
      'event:module-bundling-started',
      'load:setup.ts',
      'event:module-bundling-finished',
      'event:setup-file-bundling-finished',
      'run:setup.ts',
      'event:module-bundling-started',
      'load:test.harness.ts',
      'event:module-bundling-finished',
      'collect:start',
      'event:setup-file-bundling-started',
      'event:module-bundling-started',
      'load:after-env.ts',
      'event:module-bundling-finished',
      'event:setup-file-bundling-finished',
      'run:after-env.ts',
      'setup',
      'run:test.harness.ts',
      'collect:end',
      'runner:run',
      'release:test.harness.ts',
    ]);
  });

  it('reports a failed load and still releases the file', async () => {
    installFakes('test.harness.ts');

    await expect(runTests()).rejects.toThrow('nope');

    expect(mocks.order).not.toContain('run:test.harness.ts');
    expect(mocks.order).toContain('event:module-bundling-failed');
    expect(mocks.order.at(-1)).toBe('release:test.harness.ts');
  });

  it('reloads the runtime through the host after acknowledging the request', async () => {
    installFakes();
    vi.useFakeTimers();

    await getClient();
    await mocks.handlers?.resetEnvironment();
    expect(reloadRuntime).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });
});
