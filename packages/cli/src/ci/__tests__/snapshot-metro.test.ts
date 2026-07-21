import path from 'node:path';
import {
  runWithHarnessContext,
  type FileSystem,
} from '@react-native-harness/tools/harness-context';
import { createInMemoryFileSystem } from '@react-native-harness/tools/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSnapshotMetro } from '../snapshot-metro.js';

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
  let fileSystem: FileSystem;
  let snapshotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    fileSystem = createInMemoryFileSystem();
    projectRoot = '/project';
    githubOutputPath = path.join(projectRoot, 'github-output.txt');
    fileSystem.mkdirSync(projectRoot, { recursive: true });
    fileSystem.writeFileSync(githubOutputPath, '');

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
    delete process.env.INPUT_PROJECTROOT;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.METRO_RESTORED_KEY;
    vi.restoreAllMocks();
  });

  it('writes the current cache snapshot to GITHUB_OUTPUT as metroSnapshot', async () => {
    await runWithHarnessContext({ fs: fileSystem }, runSnapshotMetro);

    await vi.waitFor(() => {
      expect(snapshotMock).toHaveBeenCalled();
    });

    const output = fileSystem.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain(
      'metroSnapshot={"metro":[{"path":"metro/a","sizeBytes":3,"mtimeMs":1}]}\n'
    );
  });

  it('reports the restored key with file count and size when a cache entry matched', async () => {
    process.env.METRO_RESTORED_KEY = 'harness-metro-linux-abc-contenthash';
    snapshotMock.mockReturnValue({
      metro: [
        { path: 'metro/a', sizeBytes: 1024 * 1024, mtimeMs: 1 },
        { path: 'metro/b', sizeBytes: 512 * 1024, mtimeMs: 1 },
      ],
    });

    await runWithHarnessContext({ fs: fileSystem }, runSnapshotMetro);

    await vi.waitFor(() => {
      expect(snapshotMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: restored from key "harness-metro-linux-abc-contenthash" (2 files, 1.5 MB).'
    );
  });

  it('reports a cold start when no cache entry matched', async () => {
    delete process.env.METRO_RESTORED_KEY;

    await runWithHarnessContext({ fs: fileSystem }, runSnapshotMetro);

    await vi.waitFor(() => {
      expect(snapshotMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: no existing cache entry matched — starting cold.'
    );
  });

  it('fails loudly (process.exit(1)) when GITHUB_OUTPUT is not set', async () => {
    delete process.env.GITHUB_OUTPUT;

    await runWithHarnessContext({ fs: fileSystem }, runSnapshotMetro);

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
