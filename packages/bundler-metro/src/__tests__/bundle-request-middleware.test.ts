import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { Reporter, ReportableEvent } from '../reporter.js';
import { getBundleRequestObserverMiddleware } from '../middlewares/bundle-request-middleware.js';
import { HARNESS_REQUEST_KIND_HEADER } from '../request-kind.js';

const createReporter = () => {
  const events: ReportableEvent[] = [];

  const reporter: Reporter = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    clearAllListeners: vi.fn(),
    emit: (event) => {
      events.push(event);
    },
  };

  return { events, reporter };
};

const createProjectRoot = () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-bundle-request-'),
  );
  tempDirs.push(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = {};');
  return projectRoot;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const createHarnessConfig = (): HarnessConfig =>
  ({
    entryPoint: './index.js',
  }) as HarnessConfig;

describe('bundle request observer middleware', () => {
  it('emits app-originated entry bundle requests', () => {
    const { events, reporter } = createReporter();
    const middleware = getBundleRequestObserverMiddleware(
      createProjectRoot(),
      createHarnessConfig(),
      reporter,
    );
    const next = vi.fn();

    middleware(
      {
        headers: {},
        url: '/index.bundle?platform=ios&dev=true',
      } as never,
      {} as never,
      next,
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: 'bundle_request_observed',
        platform: 'ios',
        requestKind: 'app',
        url: '/index.bundle?platform=ios&dev=true',
      }),
    ]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('tags prewarm requests using the Harness header', () => {
    const { events, reporter } = createReporter();
    const middleware = getBundleRequestObserverMiddleware(
      createProjectRoot(),
      createHarnessConfig(),
      reporter,
    );

    middleware(
      {
        headers: {
          [HARNESS_REQUEST_KIND_HEADER]: 'prewarm',
        },
        url: '/index.bundle?platform=android',
      } as never,
      {} as never,
      vi.fn(),
    );

    expect(events).toEqual([
      expect.objectContaining({
        platform: 'android',
        requestKind: 'prewarm',
      }),
    ]);
  });

  it('ignores non-entry bundle requests', () => {
    const { events, reporter } = createReporter();
    const middleware = getBundleRequestObserverMiddleware(
      createProjectRoot(),
      createHarnessConfig(),
      reporter,
    );

    middleware(
      {
        headers: {},
        url: '/other.bundle?platform=ios',
      } as never,
      {} as never,
      vi.fn(),
    );

    expect(events).toEqual([]);
  });

  it('emits Expo virtual metro entry requests as app requests', () => {
    const { events, reporter } = createReporter();
    const middleware = getBundleRequestObserverMiddleware(
      createProjectRoot(),
      createHarnessConfig(),
      reporter,
    );

    middleware(
      {
        headers: {},
        url: '/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&runModule=true&app=com.example.app',
      } as never,
      {} as never,
      vi.fn(),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: 'bundle_request_observed',
        platform: 'android',
        requestKind: 'app',
        url: '/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&runModule=true&app=com.example.app',
      }),
    ]);
  });
});
