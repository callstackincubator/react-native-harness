import path from 'node:path';
import {
  runWithHarnessContext,
  type FileSystem,
} from '@react-native-harness/tools/harness-context';
import { createInMemoryFileSystem } from '@react-native-harness/tools/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPlanMetroSave } from '../plan-metro-save.js';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  createHarnessCache: vi.fn(),
  computeMetroStaticInputs: vi.fn(),
}));

vi.mock('@react-native-harness/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('@react-native-harness/cache', () => ({
  createHarnessCache: mocks.createHarnessCache,
  computeMetroStaticInputs: mocks.computeMetroStaticInputs,
}));

describe('plan-save', () => {
  let projectRoot: string;
  let githubOutputPath: string;
  let fileSystem: FileSystem;
  let planSaveMock: ReturnType<typeof vi.fn>;
  let writeKeysFileMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    fileSystem = createInMemoryFileSystem();
    projectRoot = '/project';
    githubOutputPath = path.join(projectRoot, 'github-output.txt');
    fileSystem.mkdirSync(projectRoot, { recursive: true });
    fileSystem.writeFileSync(githubOutputPath, '');

    process.env.INPUT_PROJECTROOT = projectRoot;
    process.env.GITHUB_OUTPUT = githubOutputPath;
    process.env.RUNNER_OS = 'Linux';
    process.env.INPUT_METRO_SNAPSHOT = JSON.stringify({ metro: [] });
    process.env.IS_DEFAULT_BRANCH = 'true';
    process.env.INPUT_CACHESAVEPOLICY = 'default-branch';

    mocks.getConfig.mockResolvedValue({
      config: { cache: { version: 'salt-1' } },
      projectRoot,
    });
    mocks.computeMetroStaticInputs.mockReturnValue({ lockfileHash: 'abc' });

    planSaveMock = vi.fn().mockReturnValue({
      version: 1,
      domains: {
        metro: {
          shouldSave: true,
          saveKey: 'harness-metro-linux-abc-contenthash',
          delta: { addedEntries: 1, removedEntries: 0, addedBytes: 10 },
        },
      },
    });
    writeKeysFileMock = vi.fn();

    mocks.createHarnessCache.mockReturnValue({
      planSave: planSaveMock,
      writeKeysFile: writeKeysFileMock,
    });

    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.INPUT_PROJECTROOT;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.RUNNER_OS;
    delete process.env.INPUT_METRO_SNAPSHOT;
    delete process.env.IS_DEFAULT_BRANCH;
    delete process.env.INPUT_CACHESAVEPOLICY;
    vi.restoreAllMocks();
  });

  it('writes metroShouldSave and metroSaveKey to GITHUB_OUTPUT', async () => {
    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    const output = fileSystem.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain('metroShouldSave=true\n');
    expect(output).toContain(
      'metroSaveKey=harness-metro-linux-abc-contenthash\n'
    );
  });

  it('parses the metroSnapshot input and builds the SavePolicy from env/input', async () => {
    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(planSaveMock).toHaveBeenCalled();
    });

    expect(planSaveMock).toHaveBeenCalledWith(
      { metro: [] },
      { mode: 'default-branch', isDefaultBranch: true },
      { metro: { os: 'Linux', staticInputs: { lockfileHash: 'abc' } } }
    );
  });

  it('treats an unparseable metroSnapshot input as an empty snapshot instead of throwing', async () => {
    process.env.INPUT_METRO_SNAPSHOT = 'not json';

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(planSaveMock).toHaveBeenCalled();
    });

    expect(planSaveMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.anything()
    );
    expect(console.warn).toHaveBeenCalled();
  });

  it('defaults an unrecognized cacheSavePolicy input to "default-branch"', async () => {
    process.env.INPUT_CACHESAVEPOLICY = 'bogus';

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(planSaveMock).toHaveBeenCalled();
    });

    expect(planSaveMock).toHaveBeenCalledWith(
      expect.anything(),
      { mode: 'default-branch', isDefaultBranch: true },
      expect.anything()
    );
  });

  it('reports the delta and save key when the cache changed and will be saved', async () => {
    planSaveMock.mockReturnValue({
      version: 1,
      domains: {
        metro: {
          shouldSave: true,
          saveKey: 'harness-metro-linux-abc-contenthash',
          delta: {
            addedEntries: 3,
            removedEntries: 1,
            addedBytes: 2 * 1024 * 1024,
          },
        },
      },
    });

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: changed (+3 files / 2.0 MB added, 1 removed) — saving new entry with key "harness-metro-linux-abc-contenthash".'
    );
  });

  it('reports an unchanged cache as the reason for skipping the save', async () => {
    planSaveMock.mockReturnValue({
      version: 1,
      domains: {
        metro: {
          shouldSave: false,
          saveKey: 'harness-metro-linux-abc-contenthash',
          delta: { addedEntries: 0, removedEntries: 0, addedBytes: 0 },
        },
      },
    });

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: unchanged — skipping save.'
    );
  });

  it('reports the "default-branch" policy as the reason when a change is not saved off the default branch', async () => {
    process.env.IS_DEFAULT_BRANCH = 'false';
    planSaveMock.mockReturnValue({
      version: 1,
      domains: {
        metro: {
          shouldSave: false,
          saveKey: 'harness-metro-linux-abc-contenthash',
          delta: { addedEntries: 2, removedEntries: 0, addedBytes: 1024 },
        },
      },
    });

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: changed (+2 files / 0.0 MB added, 0 removed) but save skipped by policy "default-branch" (current branch is not the default branch).'
    );
  });

  it('reports the "never" policy as the reason when a change is not saved', async () => {
    process.env.INPUT_CACHESAVEPOLICY = 'never';
    planSaveMock.mockReturnValue({
      version: 1,
      domains: {
        metro: {
          shouldSave: false,
          saveKey: 'harness-metro-linux-abc-contenthash',
          delta: { addedEntries: 2, removedEntries: 0, addedBytes: 1024 },
        },
      },
    });

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    expect(console.info).toHaveBeenCalledWith(
      'Metro cache: changed (+2 files / 0.0 MB added, 0 removed) but save skipped by policy "never".'
    );
  });

  it('fails loudly (process.exit(1)) when GITHUB_OUTPUT is not set', async () => {
    delete process.env.GITHUB_OUTPUT;

    await runWithHarnessContext({ fs: fileSystem }, runPlanMetroSave);

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
