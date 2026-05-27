import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import {
  collectCrashArtifacts,
  waitForCrashArtifact,
} from '../crash-diagnostics.js';
import * as devicectl from '../xcrun/devicectl.js';

const writeIosIpsCrashReport = (
  path: string,
  timestamp = '2026-03-12 11:35:08 +0000'
) => {
  fs.writeFileSync(
    path,
    [
      JSON.stringify({
        app_name: 'HarnessPlayground',
        bundleID: 'com.harnessplayground',
        timestamp,
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
    'utf8'
  );
};

describe('collectCrashArtifacts', () => {
  const originalDiagnosticReportsDir =
    process.env.RN_HARNESS_IOS_DIAGNOSTIC_REPORTS_DIR;
  let diagnosticReportsDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    diagnosticReportsDir = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-diagnostic-reports-')
    );
    process.env.RN_HARNESS_IOS_DIAGNOSTIC_REPORTS_DIR = diagnosticReportsDir;
  });

  afterEach(() => {
    if (originalDiagnosticReportsDir === undefined) {
      delete process.env.RN_HARNESS_IOS_DIAGNOSTIC_REPORTS_DIR;
    } else {
      process.env.RN_HARNESS_IOS_DIAGNOSTIC_REPORTS_DIR =
        originalDiagnosticReportsDir;
    }
  });

  it('collects simulator crash artifacts from host DiagnosticReports', async () => {
    writeIosIpsCrashReport(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-113508.ips')
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

  it('filters simulator crash artifacts by the lookup window', async () => {
    writeIosIpsCrashReport(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-113508.ips'),
      '2026-03-12 11:35:08 +0000'
    );
    writeIosIpsCrashReport(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-113525.ips'),
      '2026-03-12 11:35:25 +0000'
    );

    const artifacts = await collectCrashArtifacts({
      targetId: 'sim-udid',
      targetType: 'simulator',
      processNames: ['HarnessPlayground'],
      bundleId: 'com.harnessplayground',
      minOccurredAt: Date.parse('2026-03-12T11:35:07.000Z'),
      maxOccurredAt: Date.parse('2026-03-12T11:35:10.000Z'),
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.occurredAt).toBe(
      Date.parse('2026-03-12T11:35:08.000Z')
    );
  });

  it('collects device crash artifacts from systemCrashLogs', async () => {
    const outputRoot = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-devicectl-crash-logs-')
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
      'utf8'
    );

    vi.spyOn(devicectl, 'listFiles').mockResolvedValue([
      '/systemCrashLogs/HarnessPlayground-2026-03-12-113508.crash',
    ]);
    vi.spyOn(devicectl, 'copyFileFrom').mockImplementation(
      async (_deviceId, options) => {
        fs.copyFileSync(crashPath, options.destination);
      }
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
    writeIosIpsCrashReport(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-113508.ips')
    );

    const writer = createCrashArtifactWriter({
      runnerName: 'ios-sim',
      platformId: 'ios',
      rootDir: join(diagnosticReportsDir, '.harness', 'crash-reports'),
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

  it('returns a host crash report without waiting for device crash log lookup to finish', async () => {
    writeIosIpsCrashReport(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-113508.ips')
    );

    vi.spyOn(devicectl, 'listFiles').mockImplementation(
      () =>
        new Promise(() => {
          // Keep the device-side collector pending so the host lookup must win.
        })
    );

    const artifact = await waitForCrashArtifact({
      lookup: {
        processName: 'HarnessPlayground',
        pid: 1234,
        occurredAt: Date.parse('2026-03-12T11:35:08.000Z'),
      },
      options: {
        targetId: 'device-udid',
        targetType: 'device',
        processNames: ['HarnessPlayground'],
        bundleId: 'com.harnessplayground',
        minOccurredAt: Date.parse('2026-03-12T11:35:07.000Z'),
      },
      getFallbackArtifact: () => null,
      recordArtifact: vi.fn(),
    });

    expect(artifact).toMatchObject({
      processName: 'HarnessPlayground',
      pid: 1234,
      signal: 'SIGTRAP',
    });
  });
});
