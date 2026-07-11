import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { getExpoMiddleware } from '../middlewares/expo-middleware.js';
import { getResolvedEntryPointWithoutExtension } from '../entry-point-utils.js';
import {
  detectBundleClientProfile,
  getBundleSearchParams,
  getBundleUrl,
} from '../bundle-url.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const createProjectRoot = () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-bundle-url-')
  );
  tempDirs.push(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'index.js'), 'module.exports = {};');
  return projectRoot;
};

const writeExpoPackage = (projectRoot: string) => {
  const expoDir = path.join(projectRoot, 'node_modules', 'expo');
  fs.mkdirSync(expoDir, { recursive: true });
  fs.writeFileSync(
    path.join(expoDir, 'package.json'),
    JSON.stringify({ name: 'expo', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(path.join(expoDir, 'index.js'), 'module.exports = {};');
};

const createHarnessConfig = (metroPort: number): HarnessConfig =>
  ({
    entryPoint: './index.js',
    metroPort,
  } as HarnessConfig);

// Capture a fake req/res pair and return the launchAsset URL served by the
// Expo manifest middleware.
const getManifestLaunchAssetUrl = (
  projectRoot: string,
  harnessConfig: HarnessConfig,
  platform: string
): string => {
  const middleware = getExpoMiddleware(projectRoot, harnessConfig);

  let body = '';
  const res = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (chunk?: string) => {
      if (chunk) {
        body = chunk;
      }
    },
  };

  middleware(
    {
      url: '/',
      method: 'GET',
      headers: { 'expo-platform': platform },
    } as never,
    res as never,
    () => undefined
  );

  const manifest = JSON.parse(body);
  return manifest.launchAsset.url as string;
};

describe('getBundleUrl', () => {
  it('produces an expo-profile URL byte-identical to the manifest served by getExpoMiddleware', () => {
    const projectRoot = createProjectRoot();
    const harnessConfig = createHarnessConfig(8081);

    const manifestUrl = getManifestLaunchAssetUrl(
      projectRoot,
      harnessConfig,
      'ios'
    );
    const resolvedEntryPoint = getResolvedEntryPointWithoutExtension(
      projectRoot,
      harnessConfig.entryPoint
    );

    const builtUrl = getBundleUrl({
      port: harnessConfig.metroPort,
      resolvedEntryPoint,
      platform: 'ios',
      profile: 'expo',
    });

    expect(builtUrl).toBe(manifestUrl);
    expect(manifestUrl).toBe(
      `http://localhost:8081/${resolvedEntryPoint}.bundle?platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&transform.reactCompiler=true&unstable_transformProfile=hermes-stable`
    );
  });

  it('produces bare-profile params matching bare RN dev clients', () => {
    const params = getBundleSearchParams('bare', 'android');

    expect(params.toString()).toBe(
      'platform=android&dev=true&minify=false&lazy=true'
    );
  });

  it('builds a bare-profile URL', () => {
    const url = getBundleUrl({
      port: 8081,
      resolvedEntryPoint: 'index',
      platform: 'android',
      profile: 'bare',
    });

    expect(url).toBe(
      'http://localhost:8081/index.bundle?platform=android&dev=true&minify=false&lazy=true'
    );
  });
});

describe('detectBundleClientProfile', () => {
  it('detects a managed Expo project (app.json with expo key + resolvable expo)', () => {
    const projectRoot = createProjectRoot();
    fs.writeFileSync(
      path.join(projectRoot, 'app.json'),
      JSON.stringify({ expo: { name: 'my-app' } })
    );
    writeExpoPackage(projectRoot);

    expect(detectBundleClientProfile(projectRoot)).toBe('expo');
  });

  it('detects an Expo project via app.config.js + resolvable expo', () => {
    const projectRoot = createProjectRoot();
    fs.writeFileSync(
      path.join(projectRoot, 'app.config.js'),
      'module.exports = { expo: { name: "my-app" } };'
    );
    writeExpoPackage(projectRoot);

    expect(detectBundleClientProfile(projectRoot)).toBe('expo');
  });

  it('treats a bare RN project (app.json without expo key) as bare', () => {
    const projectRoot = createProjectRoot();
    fs.writeFileSync(
      path.join(projectRoot, 'app.json'),
      JSON.stringify({ name: 'my-app', displayName: 'My App' })
    );

    expect(detectBundleClientProfile(projectRoot)).toBe('bare');
  });

  it('treats a bare project with expo resolvable but no expo config as bare', () => {
    const projectRoot = createProjectRoot();
    fs.writeFileSync(
      path.join(projectRoot, 'app.json'),
      JSON.stringify({ name: 'my-app', displayName: 'My App' })
    );
    writeExpoPackage(projectRoot);

    expect(detectBundleClientProfile(projectRoot)).toBe('bare');
  });

  it('treats an unparseable app.json as bare', () => {
    const projectRoot = createProjectRoot();
    fs.writeFileSync(path.join(projectRoot, 'app.json'), '{ not valid json');
    writeExpoPackage(projectRoot);

    expect(detectBundleClientProfile(projectRoot)).toBe('bare');
  });

  it('treats a project with no app.json/app.config and no expo package as bare', () => {
    const projectRoot = createProjectRoot();

    expect(detectBundleClientProfile(projectRoot)).toBe('bare');
  });
});
