import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';

vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  isPortAvailable: vi.fn(async () => true),
  getMetroPackage: vi.fn(),
}));

vi.mock('../withRnHarness.js', () => ({
  withRnHarness: vi.fn((config: unknown) => async () => config),
}));

vi.mock('../middlewares/bundle-request-middleware.js', () => ({
  getBundleRequestObserverMiddleware: vi.fn(() => vi.fn()),
}));

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const createHttpServer = () => ({
  keepAliveTimeout: 0,
  on: vi.fn(),
  close: vi.fn((callback?: () => void) => callback?.()),
  closeAllConnections: vi.fn(),
});

// Metro 0.83+ resolves runServer with the server as a property.
const startedServer = (server: unknown) => ({ httpServer: server });

// Node checks for unhandled rejections between macrotasks, and a real Metro
// start spans many of them.
const waitForMacrotask = () => new Promise((resolve) => setImmediate(resolve));

// Whether a promise settled within a macrotask, without waiting on it longer.
const settleWithinMacrotask = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => 'resolved',
      (error: unknown) => error
    ),
    waitForMacrotask().then(() => 'still pending'),
  ]);

const startMetro = async (
  runServer: () => Promise<unknown>,
  abortSignal: AbortSignal
) => {
  const { getMetroPackage } = await import('../utils.js');
  const { getMetroInstance } = await import('../factory.js');

  vi.mocked(getMetroPackage).mockReturnValue({
    loadConfig: vi.fn(async () => ({ reporter: {} })),
    runServer: vi.fn(runServer),
  } as never);

  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-factory-')
  );
  tempDirs.push(projectRoot);

  return getMetroInstance(
    {
      projectRoot,
      harnessConfig: {
        metroPort: 8081,
        entryPoint: './index.js',
      } as HarnessConfig,
    },
    abortSignal
  );
};

const collectUnhandledRejections = async (
  work: () => Promise<void>
): Promise<unknown[]> => {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    await work();
    await waitForMacrotask();
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  return reasons;
};

describe('getMetroInstance', () => {
  it('rejects with the abort as soon as the session aborts while Metro starts, and closes the server Metro starts afterwards', async () => {
    const server = createHttpServer();
    let markServerStarting: () => void = () => undefined;
    const serverStarting = new Promise<void>((resolve) => {
      markServerStarting = resolve;
    });
    let finishServerStart: (server: unknown) => void = () => undefined;

    const unhandledRejections = await collectUnhandledRejections(async () => {
      const abortController = new AbortController();
      const instance = startMetro(() => {
        markServerStarting();
        return new Promise((resolve) => {
          finishServerStart = resolve;
        });
      }, abortController.signal);

      await Promise.race([serverStarting, instance]);
      abortController.abort();

      expect(await settleWithinMacrotask(instance)).toMatchObject({
        name: 'AbortError',
      });

      finishServerStart(startedServer(server));
      await waitForMacrotask();
    });

    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(unhandledRejections).toEqual([]);
  });

  it('rejects with the abort and closes the server when the session aborts as Metro finishes starting', async () => {
    const server = createHttpServer();
    const abortController = new AbortController();

    const instance = startMetro(() => {
      // Lands after Metro's start has settled and before Harness resumes.
      queueMicrotask(() => abortController.abort());
      return Promise.resolve(startedServer(server));
    }, abortController.signal);

    await expect(instance).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['Metro 0.83+', startedServer],
    ['Metro <0.83', (server: unknown) => server],
  ])('resolves with the server %s starts', async (_, handOver) => {
    const server = createHttpServer();

    const instance = await startMetro(
      async () => handOver(server),
      new AbortController().signal
    );

    expect(instance.httpServer).toBe(server);
    expect(server.close).not.toHaveBeenCalled();
  });

  it("rejects with Metro's own startup error and leaves no unhandled rejection when the session aborts afterwards", async () => {
    const startupError = new Error('Metro could not start');

    const unhandledRejections = await collectUnhandledRejections(async () => {
      const abortController = new AbortController();
      const instance = startMetro(
        () => Promise.reject(startupError),
        abortController.signal
      );

      await expect(instance).rejects.toBe(startupError);
      abortController.abort();
    });

    expect(unhandledRejections).toEqual([]);
  });
});
