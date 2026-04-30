import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHarnessArtifactDirectory } from '../harness-artifacts.js';

describe('createHarnessArtifactDirectory', () => {
  const rootDir = fs.mkdtempSync(
    path.join(tmpdir(), 'rn-harness-artifact-directories-')
  );

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.mkdirSync(rootDir, { recursive: true });
  });

  it('creates a reusable run directory inside the requested artifact type', () => {
    const artifacts = createHarnessArtifactDirectory({
      artifactType: 'logs',
      bundleId: 'com.harnessplayground.dev',
      platformId: 'ios',
      rootDir,
      runTimestamp: '2026-04-29T10-45-31-645Z',
      runnerName: 'xctest-agent simulator',
    });

    expect(artifacts.rootDir).toBe(path.join(rootDir, 'logs'));
    expect(artifacts.directoryPath).toBe(
      path.join(
        rootDir,
        'logs',
        '2026-04-29T10-45-31-645Z--ios--xctest-agent-simulator--com.harnessplayground.dev'
      )
    );
    expect(fs.existsSync(artifacts.directoryPath)).toBe(true);
  });
});
