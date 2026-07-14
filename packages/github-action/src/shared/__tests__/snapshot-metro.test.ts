import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  createHarnessCache: vi.fn(),
}));

vi.mock('@react-native-harness/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('@react-native-harness/cache', () => ({
  createHarnessCache: mocks.createHarnessCache,
}));

describe('snapshot-metro', () => {
  let projectRoot: string;
  let githubOutputPath: string;
  let snapshotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-snapshot-metro-'));
    githubOutputPath = path.join(projectRoot, 'github-output.txt');
    fs.writeFileSync(githubOutputPath, '');

    process.env.INPUT_PROJECTROOT = projectRoot;
    process.env.GITHUB_OUTPUT = githubOutputPath;

    mocks.getConfig.mockResolvedValue({
      config: {},
      projectRoot,
    });

    snapshotMock = vi.fn().mockReturnValue({
      metro: [{ path: 'metro/a', sizeBytes: 3, mtimeMs: 1 }],
    });

    mocks.createHarnessCache.mockReturnValue({
      snapshot: snapshotMock,
    });

    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    delete process.env.INPUT_PROJECTROOT;
    delete process.env.GITHUB_OUTPUT;
    vi.restoreAllMocks();
  });

  it('writes the current cache snapshot to GITHUB_OUTPUT as metroSnapshot', async () => {
    await import('../snapshot-metro.js');

    await vi.waitFor(() => {
      expect(snapshotMock).toHaveBeenCalled();
    });

    const output = fs.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain(
      'metroSnapshot={"metro":[{"path":"metro/a","sizeBytes":3,"mtimeMs":1}]}\n'
    );
  });

  it('fails loudly (process.exit(1)) when GITHUB_OUTPUT is not set', async () => {
    delete process.env.GITHUB_OUTPUT;

    await import('../snapshot-metro.js');

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
