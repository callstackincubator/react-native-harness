import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tools from '@react-native-harness/tools';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import {
  assertLibimobiledeviceInstalled,
  collectCrashReports,
} from '../libimobiledevice.js';

describe('assertLibimobiledeviceInstalled', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when all required binaries are present', async () => {
    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: '/opt/homebrew/bin/tool\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(assertLibimobiledeviceInstalled()).resolves.toBeUndefined();
  });

  it('throws when any required binary is missing', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy
      .mockResolvedValueOnce({
        stdout: '/opt/homebrew/bin/idevicesyslog\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockRejectedValueOnce(new Error('missing'));

    await expect(assertLibimobiledeviceInstalled()).rejects.toMatchObject({
      name: 'DependencyNotFoundError',
      dependencyName: 'libimobiledevice',
    });
  });
});

describe('collectCrashReports', () => {
  const workDir = fs.mkdtempSync(join(tmpdir(), 'rn-harness-ios-crash-tests-'));
  const artifactRoot = fs.mkdtempSync(join(tmpdir(), 'rn-harness-ios-crash-artifacts-'));

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.rmSync(artifactRoot, { recursive: true, force: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
  });

  it('extracts matching crash reports with artifact metadata', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    const spawnSpy = vi.spyOn(tools, 'spawn').mockImplementation(
      (async (file: string, args?: readonly string[]) => {
        if (file === 'idevicecrashreport') {
          const targetDir = args?.[args.length - 1];

          if (!targetDir) {
            throw new Error('missing target dir');
          }

          fs.writeFileSync(
            join(targetDir, 'HarnessPlayground-2026-03-12-113508.crash'),
            [
              'Process:               HarnessPlayground [1234]',
              'Identifier:            com.harnessplayground',
              'Exception Type:        EXC_CRASH (SIGABRT)',
              'Triggered by Thread:  0',
              '',
              'Thread 0 Crashed:',
              '0   HarnessPlayground                  0x0000000100000000 AppDelegate.crashIfRequested() + 20',
              '1   HarnessPlayground                  0x0000000100000014 AppDelegate.application(_:didFinishLaunchingWithOptions:) + 40',
              '',
            ].join('\n')
          );
        }

        return {
          stdout: '',
        } as Awaited<ReturnType<typeof tools.spawn>>;
      }) as typeof tools.spawn
    );

    const reports = await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(spawnSpy).toHaveBeenCalledWith('idevicecrashreport', [
      '-u',
      'device-udid',
      '--keep',
      '--extract',
      '--filter',
      'HarnessPlayground',
      expect.any(String),
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      artifactType: 'ios-crash-report',
      processName: 'HarnessPlayground',
      pid: 1234,
      signal: 'SIGABRT',
      exceptionType: 'EXC_CRASH (SIGABRT)',
      stackTrace: [
        '0   HarnessPlayground                  0x0000000100000000 AppDelegate.crashIfRequested() + 20',
        '1   HarnessPlayground                  0x0000000100000014 AppDelegate.application(_:didFinishLaunchingWithOptions:) + 40',
      ],
    });
  });

  it('filters by executable name rather than bundle id', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: '',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['com.harnessplayground', 'HarnessPlayground'],
    });

    expect(spawnSpy).toHaveBeenCalledWith('idevicecrashreport', [
      '-u',
      'device-udid',
      '--keep',
      '--extract',
      '--filter',
      'HarnessPlayground',
      expect.any(String),
    ]);
  });

  it('parses .ips crash reports from the device', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    vi.spyOn(tools, 'spawn').mockImplementation(
      (async (file: string, args?: readonly string[]) => {
        if (file === 'idevicecrashreport') {
          const targetDir = args?.[args.length - 1];

          if (!targetDir) {
            throw new Error('missing target dir');
          }

          const header = JSON.stringify({
            app_name: 'HarnessPlayground',
            bundleID: 'com.harnessplayground',
          });
          const body = JSON.stringify({
            pid: 21675,
            procName: 'HarnessPlayground',
            faultingThread: 0,
            exception: { type: 'EXC_BREAKPOINT', signal: 'SIGTRAP' },
            threads: [
              {
                frames: [
                  { imageIndex: 0, symbol: 'AppDelegate.crashIfRequested()', symbolLocation: 20 },
                ],
              },
            ],
            usedImages: [{ name: 'HarnessPlayground' }],
          });

          fs.writeFileSync(
            join(targetDir, 'HarnessPlayground-2026-03-12-113508.ips'),
            `${header}\n${body}`
          );
        }

        return {
          stdout: '',
        } as Awaited<ReturnType<typeof tools.spawn>>;
      }) as typeof tools.spawn
    );

    const reports = await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      artifactType: 'ios-crash-report',
      processName: 'HarnessPlayground',
      pid: 21675,
      signal: 'SIGTRAP',
      exceptionType: 'EXC_BREAKPOINT',
      stackTrace: ['0 AppDelegate.crashIfRequested() (+ 20)'],
    });
  });

  it('persists pulled crash reports before temporary cleanup', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    vi.spyOn(tools, 'spawn').mockImplementation(
      (async (file: string, args?: readonly string[]) => {
        if (file === 'idevicecrashreport') {
          const targetDir = args?.[args.length - 1];

          if (!targetDir) {
            throw new Error('missing target dir');
          }

          fs.writeFileSync(
            join(targetDir, 'HarnessPlayground-2026-03-12-113508.crash'),
            [
              'Process:               HarnessPlayground [1234]',
              'Identifier:            com.harnessplayground',
              'Exception Type:        EXC_CRASH (SIGABRT)',
            ].join('\n')
          );
        }

        return {
          stdout: '',
        } as Awaited<ReturnType<typeof tools.spawn>>;
      }) as typeof tools.spawn
    );
    const crashReportDir = join(artifactRoot, '.harness', 'crash-reports');
    const writer = createCrashArtifactWriter({
      runnerName: 'ios-device',
      platformId: 'ios',
      rootDir: crashReportDir,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const reports = await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
      crashArtifactWriter: writer,
    });

    expect(reports[0]?.artifactPath).toContain('/.harness/crash-reports/');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(fs.existsSync(reports[0]!.artifactPath)).toBe(true);
    expect(fs.existsSync(workDir)).toBe(false);
  });

  it('returns an empty list when no matching crash reports are found', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: '',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    const reports = await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(reports).toEqual([]);
  });

  it('ignores crash reports older than the current run window', async () => {
    vi.spyOn(fs, 'mkdtempSync').mockReturnValue(workDir);
    vi.spyOn(tools, 'spawn').mockImplementation(
      (async (file: string, args?: readonly string[]) => {
        if (file === 'idevicecrashreport') {
          const targetDir = args?.[args.length - 1];

          if (!targetDir) {
            throw new Error('missing target dir');
          }

          fs.writeFileSync(
            join(targetDir, 'old.crash'),
            [
              'Process:               HarnessPlayground [1234]',
              'Identifier:            com.harnessplayground',
              'Date/Time:             2026-03-12 11:30:08.000 +0000',
            ].join('\n')
          );
          fs.writeFileSync(
            join(targetDir, 'new.crash'),
            [
              'Process:               HarnessPlayground [1235]',
              'Identifier:            com.harnessplayground',
              'Date/Time:             2026-03-12 11:40:08.000 +0000',
            ].join('\n')
          );
        }

        return {
          stdout: '',
        } as Awaited<ReturnType<typeof tools.spawn>>;
      }) as typeof tools.spawn
    );

    const reports = await collectCrashReports({
      targetId: 'device-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
      minOccurredAt: Date.parse('2026-03-12T11:35:08.000Z'),
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.pid).toBe(1235);
  });
});
