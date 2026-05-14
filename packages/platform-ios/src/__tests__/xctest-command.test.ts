import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseXCTestBuildArgs,
  runXCTestBuildCommand,
  type XCTestBuildModule,
} from '../xctest-command.js';

describe('xctest build command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a simulator build destination', () => {
    const args = parseXCTestBuildArgs(['--destination', 'simulator']);

    expect(args).toEqual({
      destination: 'simulator',
      provisioningProfile: undefined,
      signingIdentity: undefined,
      teamId: undefined,
    });
  });

  it('runs a device build without signing options', async () => {
    const buildXCTestAgent = vi.fn(async () => ({
      derivedDataPath: '/tmp/project/.harness/xctest-agent/device',
      destination: 'device' as const,
      reused: false,
      xctestrunPath: '/tmp/project/.harness/xctest-agent/device/file.xctestrun',
    }));
    const xctest = {
      buildXCTestAgent,
    } satisfies XCTestBuildModule;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runXCTestBuildCommand({
      args: ['--destination', 'device'],
      cwd: '/tmp/project',
      xctest,
    });

    expect(buildXCTestAgent).toHaveBeenCalledWith({
      destination: 'device',
      projectRoot: '/tmp/project',
      signing: undefined,
    });
  });

  it('runs a signed device build when signing options are provided', async () => {
    const buildXCTestAgent = vi.fn(async () => ({
      derivedDataPath: '/tmp/project/.harness/xctest-agent/device',
      destination: 'device' as const,
      reused: true,
    }));
    const xctest = {
      buildXCTestAgent,
    } satisfies XCTestBuildModule;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runXCTestBuildCommand({
      args: ['--destination', 'device', '--teamId', 'TESTTEAM01'],
      cwd: '/tmp/project',
      xctest,
    });

    expect(buildXCTestAgent).toHaveBeenCalledWith({
      destination: 'device',
      projectRoot: '/tmp/project',
      signing: {
        provisioningProfile: undefined,
        signingIdentity: undefined,
        teamId: 'TESTTEAM01',
      },
    });
  });

  it('throws when destination is missing', () => {
    expect(() => parseXCTestBuildArgs([])).toThrow(
      'Missing required argument: destination'
    );
  });

  it('throws when destination is invalid', () => {
    expect(() => parseXCTestBuildArgs(['--destination', 'android'])).toThrow(
      'Invalid values:'
    );
  });
});
