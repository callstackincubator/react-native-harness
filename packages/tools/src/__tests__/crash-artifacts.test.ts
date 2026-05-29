import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCrashArtifactWriter } from '../crash-artifacts.js';

describe('createCrashArtifactWriter', () => {
  const rootDir = fs.mkdtempSync(
    path.join(tmpdir(), 'rn-harness-crash-artifacts-')
  );

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.mkdirSync(rootDir, { recursive: true });
  });

  it('nests artifacts by run timestamp, runner, and test file', () => {
    const sourcePath = path.join(rootDir, 'Harness Playground 01.crash');
    fs.writeFileSync(sourcePath, 'crash data', 'utf8');

    const writer = createCrashArtifactWriter({
      runnerName: 'ios simulator',
      platformId: 'ios',
      rootDir,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const persistedPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      testFilePath: path.join(
        process.cwd(),
        'src/__tests__/crash/ios/swift-sync.harness.ts'
      ),
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });

    expect(path.relative(rootDir, persistedPath)).toBe(
      path.join(
        '2026-03-12T11-35-08-000Z',
        'ios-simulator',
        'src-__tests__-crash-ios-swift-sync.harness.ts',
        'ios--ios-crash-report--Harness-Playground-01.crash'
      )
    );
    expect(fs.readFileSync(persistedPath, 'utf8')).toBe('crash data');
    expect(writer.runTimestamp).toBe('2026-03-12T11-35-08-000Z');
  });

  it('creates the artifact directory lazily and writes text artifacts', () => {
    const artifactRoot = path.join(rootDir, '.harness', 'crash-reports');
    const writer = createCrashArtifactWriter({
      runnerName: 'android',
      platformId: 'android',
      rootDir: artifactRoot,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const persistedPath = writer.persistArtifact({
      artifactKind: 'logcat',
      source: {
        kind: 'text',
        fileName: 'logcat.txt',
        text: '--------- beginning of crash\nRuntimeException: boom\n',
      },
    });

    expect(fs.existsSync(artifactRoot)).toBe(true);
    expect(fs.readFileSync(persistedPath, 'utf8')).toContain(
      'RuntimeException'
    );
  });

  it('falls back to an absolute test path segment outside the current project', () => {
    const sourcePath = path.join(rootDir, 'Harness Playground 01.crash');
    const testFilePath = path.join(rootDir, 'tests', 'native crash.test.ts');
    fs.writeFileSync(sourcePath, 'crash data', 'utf8');

    const writer = createCrashArtifactWriter({
      runnerName: 'ios simulator',
      platformId: 'ios',
      rootDir,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const persistedPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      testFilePath,
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });

    expect(path.relative(rootDir, persistedPath)).toBe(
      path.join(
        '2026-03-12T11-35-08-000Z',
        'ios-simulator',
        path
          .resolve(testFilePath)
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, ''),
        'ios--ios-crash-report--Harness-Playground-01.crash'
      )
    );
  });

  it('deduplicates repeated persistence requests within one run', () => {
    const sourcePath = path.join(rootDir, 'duplicate.crash');
    fs.writeFileSync(sourcePath, 'same crash', 'utf8');

    const writer = createCrashArtifactWriter({
      runnerName: 'ios',
      platformId: 'ios',
      rootDir,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const firstPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });
    const secondPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });

    expect(firstPath).toBe(secondPath);
    expect(fs.readdirSync(path.dirname(firstPath))).toEqual([
      'ios--ios-crash-report--duplicate.crash',
    ]);
  });

  it('keeps artifacts for different test files separate', () => {
    const sourcePath = path.join(rootDir, 'duplicate.crash');
    fs.writeFileSync(sourcePath, 'same crash', 'utf8');

    const writer = createCrashArtifactWriter({
      runnerName: 'ios',
      platformId: 'ios',
      rootDir,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const firstPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      testFilePath: '/tmp/a.test.ts',
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });
    const secondPath = writer.persistArtifact({
      artifactKind: 'ios-crash-report',
      testFilePath: '/tmp/b.test.ts',
      source: {
        kind: 'file',
        path: sourcePath,
      },
    });

    expect(firstPath).not.toBe(secondPath);
    expect(path.dirname(firstPath)).not.toBe(path.dirname(secondPath));
  });
});
