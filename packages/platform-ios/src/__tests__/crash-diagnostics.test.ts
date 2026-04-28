import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import { collectCrashArtifacts } from '../crash-diagnostics.js';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';

describe('collectCrashArtifacts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('collects simulator crash artifacts from simctl diagnose output', async () => {
    const outputRoot = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-simctl-diagnose-'),
    );
    const crashPath = join(outputRoot, 'HarnessPlayground.ips');
    fs.writeFileSync(
      crashPath,
      [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
          timestamp: '2026-03-12 11:35:08 +0000',
        }),
        JSON.stringify({
          pid: 1234,
          procName: 'HarnessPlayground',
          procPath:
            '/Users/me/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground',
          exception: {
            type: 'EXC_BREAKPOINT',
            signal: 'SIGTRAP',
          },
        }),
      ].join('\n'),
      'utf8',
    );

    vi.spyOn(simctl, 'diagnose').mockImplementation(
      async (_udid, outputDir) => {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.copyFileSync(crashPath, join(outputDir, 'HarnessPlayground.ips'));
      },
    );

    const artifacts = await collectCrashArtifacts({
      targetId: 'sim-udid',
      targetType: 'simulator',
      processNames: ['HarnessPlayground'],
      bundleId: 'com.harnessplayground',
      minOccurredAt: Date.parse('2026-03-12T11:35:07.000Z'),
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      artifactType: 'ios-crash-report',
      processName: 'HarnessPlayground',
      pid: 1234,
      exceptionType: 'EXC_BREAKPOINT',
      signal: 'SIGTRAP',
      targetId: 'sim-udid',
    });
  });

  it('collects device crash artifacts from systemCrashLogs', async () => {
    const outputRoot = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-devicectl-crash-logs-'),
    );
    const crashPath = join(outputRoot, 'HarnessPlayground.crash');
    fs.writeFileSync(
      crashPath,
      [
        'Process:               HarnessPlayground [4321]',
        'Identifier:            com.harnessplayground',
        'Date/Time:             2026-03-12 11:35:08 +0000',
        'Exception Type:        EXC_CRASH (SIGABRT)',
      ].join('\n'),
      'utf8',
    );

    vi.spyOn(devicectl, 'listFiles').mockResolvedValue([
      '/systemCrashLogs/HarnessPlayground-2026-03-12-113508.crash',
    ]);
    vi.spyOn(devicectl, 'copyFileFrom').mockImplementation(
      async (_deviceId, options) => {
        fs.copyFileSync(crashPath, options.destination);
      },
    );
    const artifacts = await collectCrashArtifacts({
      targetId: 'device-udid',
      targetType: 'device',
      processNames: ['HarnessPlayground'],
      bundleId: 'com.harnessplayground',
      minOccurredAt: Date.parse('2026-03-12T11:35:07.000Z'),
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      processName: 'HarnessPlayground',
      pid: 4321,
      bundleId: 'com.harnessplayground',
      signal: 'SIGABRT',
    });
  });

  it('persists matched crash artifacts with the provided writer', async () => {
    const sourceRoot = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-crash-diagnostics-'),
    );
    const sourcePath = join(sourceRoot, 'HarnessPlayground.ips');
    fs.writeFileSync(
      sourcePath,
      [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
          timestamp: '2026-03-12 11:35:08 +0000',
        }),
        JSON.stringify({
          pid: 1234,
          procName: 'HarnessPlayground',
          procPath:
            '/Users/me/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground',
          exception: {
            type: 'EXC_BREAKPOINT',
            signal: 'SIGTRAP',
          },
        }),
      ].join('\n'),
      'utf8',
    );

    vi.spyOn(simctl, 'diagnose').mockImplementation(
      async (_udid, outputDir) => {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.copyFileSync(sourcePath, join(outputDir, 'HarnessPlayground.ips'));
      },
    );

    const writer = createCrashArtifactWriter({
      runnerName: 'ios-sim',
      platformId: 'ios',
      rootDir: join(sourceRoot, '.harness', 'crash-reports'),
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const artifacts = await collectCrashArtifacts({
      targetId: 'sim-udid',
      targetType: 'simulator',
      processNames: ['HarnessPlayground'],
      bundleId: 'com.harnessplayground',
      crashArtifactWriter: writer,
    });

    expect(artifacts[0]?.artifactPath).toContain('/.harness/crash-reports/');
    expect(fs.existsSync(artifacts[0]?.artifactPath ?? '')).toBe(true);
  });
});
