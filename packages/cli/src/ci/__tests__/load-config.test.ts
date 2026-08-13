import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock('@react-native-harness/config', () => ({
  getConfig: mocks.getConfig,
}));

describe('load-config', () => {
  let workspaceRoot: string;
  let githubOutputPath: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gha-load-config-workspace-')
    );
    githubOutputPath = path.join(workspaceRoot, 'github-output.txt');
    fs.writeFileSync(githubOutputPath, '');

    process.env.INPUT_RUNNER = 'ios';
    process.env.GITHUB_OUTPUT = githubOutputPath;

    mocks.getConfig.mockImplementation(async (projectRoot: string) => ({
      config: {
        runners: [
          {
            name: 'ios',
            platformId: 'ios',
            config: { device: { type: 'simulator' } },
          },
        ],
      },
      projectRoot,
    }));

    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    delete process.env.INPUT_RUNNER;
    delete process.env.INPUT_PROJECTROOT;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_WORKSPACE;
    vi.restoreAllMocks();
  });

  // Regression test for a bug where INPUT_PROJECTROOT (workspace-relative,
  // as the composite action passes it) was resolved against process.cwd()
  // instead of GITHUB_WORKSPACE. Since the action also sets a per-step
  // `working-directory` equal to the resolved project root, that produced a
  // doubled-up path like "<workspaceRoot>/apps/foo/apps/foo" and an emitted
  // projectRoot of "." instead of "apps/foo" -- silently pointing
  // actions/cache and actions/upload-artifact (which resolve paths against
  // the workspace root, not any step's working-directory) at the wrong
  // directory.
  it('resolves a workspace-relative INPUT_PROJECTROOT against GITHUB_WORKSPACE, not process.cwd()', async () => {
    const projectDir = path.join(workspaceRoot, 'apps', 'foo');
    fs.mkdirSync(projectDir, { recursive: true });

    process.env.GITHUB_WORKSPACE = workspaceRoot;
    process.env.INPUT_PROJECTROOT = 'apps/foo';
    // Mirrors the action's `working-directory: ${{ steps.load-config.outputs.projectRoot }}`
    // convention on later ci steps: process.cwd() differs from the
    // workspace root even though INPUT_PROJECTROOT is workspace-relative.
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { runLoadConfig } = await import('../load-config.js');
    await runLoadConfig();

    expect(mocks.getConfig).toHaveBeenCalledWith(projectDir);
    expect(mocks.getConfig).not.toHaveBeenCalledWith(
      path.join(projectDir, 'apps', 'foo')
    );

    const output = fs.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain('projectRoot=apps/foo\n');
    expect(output).not.toContain('projectRoot=.\n');
  });

  it('falls back to GITHUB_WORKSPACE itself when INPUT_PROJECTROOT is unset', async () => {
    process.env.GITHUB_WORKSPACE = workspaceRoot;

    const { runLoadConfig } = await import('../load-config.js');
    await runLoadConfig();

    expect(mocks.getConfig).toHaveBeenCalledWith(workspaceRoot);

    const output = fs.readFileSync(githubOutputPath, 'utf8');
    expect(output).toContain('projectRoot=.\n');
  });

  it('falls back to process.cwd() when GITHUB_WORKSPACE is unset, for local invocation', async () => {
    const cwd = path.join(workspaceRoot, 'local-cwd');
    fs.mkdirSync(cwd, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const { runLoadConfig } = await import('../load-config.js');
    await runLoadConfig();

    expect(mocks.getConfig).toHaveBeenCalledWith(cwd);
  });
});
