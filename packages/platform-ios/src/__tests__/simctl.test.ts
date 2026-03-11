import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import { collectCrashReports } from '../xcrun/simctl.js';

describe('simctl collectCrashReports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts matching simulator .ips crash reports', async () => {
    const diagnosticReportsDir = join(
      homedir(),
      'Library',
      'Logs',
      'DiagnosticReports'
    );
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'HarnessPlayground-2026-03-12-122756.ips',
      'OtherApp-2026-03-12-122756.ips',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor) => {
      const filePath = String(path);

      if (filePath.includes('HarnessPlayground')) {
        return [
          JSON.stringify({
            app_name: 'HarnessPlayground',
            bundleID: 'com.harnessplayground',
            name: 'HarnessPlayground',
          }),
          JSON.stringify({
            pid: 1234,
            procName: 'HarnessPlayground',
            faultingThread: 0,
            threads: [
              {
                frames: [
                  {
                    symbol: '_assertionFailure(_:_:file:line:flags:)',
                    symbolLocation: 156,
                    imageIndex: 1,
                  },
                  {
                    symbol: 'AppDelegate.crashIfRequested()',
                    sourceFile: 'AppDelegate.swift',
                    sourceLine: 31,
                    imageIndex: 1,
                  },
                ],
              },
            ],
            usedImages: [{ name: 'dyld' }, { name: 'HarnessPlayground' }],
            procPath:
              `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
            exception: {
              type: 'EXC_BREAKPOINT',
              signal: 'SIGTRAP',
            },
          }),
        ].join('\n');
      }

      return [
        JSON.stringify({
          app_name: 'OtherApp',
          bundleID: 'com.other.app',
        }),
        JSON.stringify({
          procName: 'OtherApp',
          procPath:
            `${homedir()}/Library/Developer/CoreSimulator/Devices/other-udid/data/Containers/Bundle/Application/DEF/OtherApp.app/OtherApp`,
        }),
      ].join('\n');
    }) as typeof fs.readFileSync);
    vi.spyOn(fs, 'statSync').mockReturnValue({
      mtimeMs: 123456,
    } as fs.Stats);

    const reports = await collectCrashReports({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(reports).toEqual([
      {
        artifactType: 'ios-simulator-crash-report',
        artifactPath: join(
          diagnosticReportsDir,
          'HarnessPlayground-2026-03-12-122756.ips'
        ),
        occurredAt: 123456,
        processName: 'HarnessPlayground',
        pid: 1234,
        signal: 'SIGTRAP',
        exceptionType: 'EXC_BREAKPOINT',
        stackTrace: [
          '0 _assertionFailure(_:_:file:line:flags:) (+ 156)',
          '1 AppDelegate.crashIfRequested() (AppDelegate.swift:31)',
        ],
        rawLines: expect.any(Array),
      },
    ]);
  });

  it('copies matched simulator reports into .harness when a writer is provided', async () => {
    const tempRoot = fs.mkdtempSync(
      join(tmpdir(), 'rn-harness-simctl-artifacts-')
    );
    const artifactRoot = join(tempRoot, '.harness', 'crash-reports');
    const diagnosticReportsDir = join(
      homedir(),
      'Library',
      'Logs',
      'DiagnosticReports'
    );

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'HarnessPlayground-2026-03-12-122756.ips',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
          name: 'HarnessPlayground',
        }),
        JSON.stringify({
          pid: 1234,
          procName: 'HarnessPlayground',
          procPath:
            `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
          exception: {
            type: 'EXC_BREAKPOINT',
            signal: 'SIGTRAP',
          },
        }),
      ].join('\n') as ReturnType<typeof fs.readFileSync>
    );
    vi.spyOn(fs, 'statSync').mockReturnValue({
      mtimeMs: 123456,
    } as fs.Stats);
    const copyFileSyncSpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);
    const writer = createCrashArtifactWriter({
      runnerName: 'ios-sim',
      platformId: 'ios',
      rootDir: artifactRoot,
      runTimestamp: '2026-03-12T11-35-08-000Z',
    });

    const reports = await collectCrashReports({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
      crashArtifactWriter: writer,
    });

    expect(reports[0]?.artifactPath).toContain('/.harness/crash-reports/');
    expect(copyFileSyncSpy).toHaveBeenCalledWith(
      join(diagnosticReportsDir, 'HarnessPlayground-2026-03-12-122756.ips'),
      reports[0]?.artifactPath
    );
  });

  it('ignores simulator reports older than the current run window', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'old.ips',
      'new.ips',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((input: fs.PathOrFileDescriptor) => {
      const filePath = String(input);

      return [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
          name: 'HarnessPlayground',
        }),
        JSON.stringify({
          pid: filePath.includes('old') ? 1234 : 1235,
          procName: 'HarnessPlayground',
          procPath:
            `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
          exception: {
            type: 'EXC_BREAKPOINT',
            signal: 'SIGTRAP',
          },
        }),
      ].join('\n');
    }) as typeof fs.readFileSync);
    vi.spyOn(fs, 'statSync').mockImplementation(((input: fs.PathLike) => ({
      mtimeMs: String(input).includes('old')
        ? Date.parse('2026-03-12T11:30:08.000Z')
        : Date.parse('2026-03-12T11:40:08.000Z'),
    })) as typeof fs.statSync);

    const reports = await collectCrashReports({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
      minOccurredAt: Date.parse('2026-03-12T11:35:08.000Z'),
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.pid).toBe(1235);
  });
});
