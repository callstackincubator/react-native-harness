import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HarnessBundler } from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBundlerInstance,
  isMetroBundler,
  resolveBundler,
} from '../bundler.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const writeFakeBundlerModule = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-bundler-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'fake-bundler.mjs');
  fs.writeFileSync(
    file,
    `export default async (options, signal) => ({
      received: { options, signal },
      events: { addListener() {}, removeListener() {}, emit() {}, clearAllListeners() {} },
      waitUntilHealthy: async () => 'ok',
      prewarm: async () => true,
      getPrewarmState: () => 'idle',
      isBuildInFlight: () => false,
      dispose: async () => undefined,
    });`
  );
  return pathToFileURL(file).href;
};

describe('resolveBundler', () => {
  it('falls back to Metro when the config names no bundler', () => {
    expect(resolveBundler({})).toMatchObject({
      name: 'metro',
      displayName: 'Metro',
      config: {},
    });
  });

  it('uses the bundler the config names', () => {
    const bundler: HarnessBundler = {
      name: 'custom',
      displayName: 'Custom',
      module: 'file:///custom.js',
      config: { option: true },
    };

    expect(resolveBundler({ bundler })).toBe(bundler);
  });
});

describe('createBundlerInstance', () => {
  it('imports the descriptor module and passes it the options and its config', async () => {
    const bundler: HarnessBundler = {
      name: 'custom',
      displayName: 'Custom',
      module: writeFakeBundlerModule(),
      config: { option: true },
    };
    const signal = new AbortController().signal;
    const options = {
      projectRoot: '/project',
      harnessConfig: { metroPort: 8081 } as HarnessConfig,
      websocketEndpoints: {},
      platform: { name: 'web', platformId: 'web' } as HarnessPlatform,
      watchMode: false,
    };

    const instance = await createBundlerInstance(bundler, options, signal);

    expect(
      (instance as unknown as { received: unknown }).received
    ).toEqual({
      options: { ...options, config: { option: true } },
      signal,
    });
  });
});

describe('isMetroBundler', () => {
  it('is true for the default bundler and false for another', () => {
    expect(isMetroBundler(resolveBundler({}))).toBe(true);
    expect(isMetroBundler({ name: 'webpack' })).toBe(false);
  });
});
