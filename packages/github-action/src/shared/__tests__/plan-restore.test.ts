import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  createHarnessCache: vi.fn(),
  computeMetroStaticInputs: vi.fn(),
}));

vi.mock('@react-native-harness/config', () => ({
  getConfig: mocks.getConfig,
}));

// This package's job is wiring, not re-testing @react-native-harness/cache's
// own logic, so its exports are mocked rather than exercised for real.
vi.mock('@react-native-harness/cache', () => ({
  createHarnessCache: mocks.createHarnessCache,
  computeMetroStaticInputs: mocks.computeMetroStaticInputs,
}));

describe('plan-restore', () => {
  let projectRoot: string;
  let githubOutputPath: string;
  let planRestoreMock: ReturnType<typeof vi.fn>;
  let writeKeysFileMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-plan-restore-'));
    githubOutputPath = path.join(projectRoot, 'github-output.txt');
    fs.writeFileSync(githubOutputPath, '');

    process.env.INPUT_PROJECTROOT = projectRoot;
    process.env.GITHUB_OUTPUT = githubOutputPath;
    process.env.RUNNER_OS = 'Linux';

    mocks.getConfig.mockResolvedValue({
      config: { cache: { version: 'salt-1' } },
      projectRoot,
    });
    mocks.computeMetroStaticInputs.mockReturnValue({ lockfileHash: 'abc' });

    planRestoreMock = vi.fn().mockReturnValue({
      version: 1,
      domains: {
        metro: {
          paths: ['/tmp/metro', '/tmp/metro-file-map'],
          restoreKey: 'harness-metro-linux-abc',
          restorePrefixes: ['harness-metro-linux-abc-'],
          accretive: true,
        },
      },
    });
    writeKeysFileMock = vi.fn();

    mocks.createHarnessCache.mockReturnValue({
      planRestore: planRestoreMock,
      writeKeysFile: writeKeysFileMock,
    });

    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    delete process.env.INPUT_PROJECTROOT;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.RUNNER_OS;
    vi.restoreAllMocks();
  });

  it('writes metroRestoreKey and metroRestorePrefixes (as JSON) to GITHUB_OUTPUT', async () => {
    await import('../plan-restore.js');

    await vi.waitFor(() => {
      expect(writeKeysFileMock).toHaveBeenCalled();
    });

    const output = fs.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain('metroRestoreKey=harness-metro-linux-abc\n');
    expect(output).toContain(
      'metroRestorePrefixes=["harness-metro-linux-abc-"]\n'
    );
    // The pre-run snapshot is taken by the separate snapshot-metro step,
    // which runs after the actual cache restore -- not here.
    expect(output).not.toContain('metroSnapshot');
  });

  it('calls planRestore with the os and staticInputs assembled from the Metro key recipe', async () => {
    await import('../plan-restore.js');

    await vi.waitFor(() => {
      expect(planRestoreMock).toHaveBeenCalled();
    });

    expect(planRestoreMock).toHaveBeenCalledWith({
      metro: { os: 'Linux', staticInputs: { lockfileHash: 'abc' } },
    });
    expect(mocks.computeMetroStaticInputs).toHaveBeenCalledWith(
      expect.objectContaining({ salt: 'salt-1' })
    );
  });

  it('fails loudly (process.exit(1)) when GITHUB_OUTPUT is not set', async () => {
    delete process.env.GITHUB_OUTPUT;

    await import('../plan-restore.js');

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(1);
    });
    expect(console.error).toHaveBeenCalledWith(
      'GITHUB_OUTPUT environment variable is not set'
    );
  });
});
