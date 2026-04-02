import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createCrashArtifactWriter } from '@react-native-harness/tools';
import * as tools from '@react-native-harness/tools';
import { collectCrashReports, waitForBoot } from '../xcrun/simctl.js';

describe('simctl startup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the abort signal to simctl bootstatus', async () => {
    const signal = new AbortController().signal;
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValue({} as Awaited<ReturnType<typeof tools.spawn>>);

    await waitForBoot('sim-udid', signal);

    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'bootstatus', 'sim-udid', '-b'],
      { signal }
    );
  });
});

describe('simctl collectCrashReports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts matching simulator .ips crash reports by filename prefix', async () => {
    const diagnosticReportsDir = join(
      homedir(),
      'Library',
      'Logs',
      'DiagnosticReports'
    );
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    // OtherApp file is present but must be ignored purely based on filename prefix
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'HarnessPlayground-2026-03-12-122756.ips',
      'OtherApp-2026-03-12-122756.ips',
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
          procPath: `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
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

    const reports = await collectCrashReports({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(reports).toEqual([
      {
        artifactType: 'ios-crash-report',
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
          procPath: `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
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
    const copyFileSyncSpy = vi
      .spyOn(fs, 'copyFileSync')
      .mockImplementation(() => undefined);
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
      'HarnessPlayground-2026-03-12-113008.ips',
      'HarnessPlayground-2026-03-12-114008.ips',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      input: fs.PathOrFileDescriptor
    ) => {
      const filePath = String(input);

      return [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
          name: 'HarnessPlayground',
        }),
        JSON.stringify({
          pid: filePath.includes('113008') ? 1234 : 1235,
          procName: 'HarnessPlayground',
          procPath: `${homedir()}/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
          exception: {
            type: 'EXC_BREAKPOINT',
            signal: 'SIGTRAP',
          },
        }),
      ].join('\n');
    }) as typeof fs.readFileSync);
    vi.spyOn(fs, 'statSync').mockImplementation(((input: fs.PathLike) => ({
      mtimeMs: String(input).includes('113008')
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

  it('returns the latest crash report that matches the simulator udid, skipping newer ones from other simulators', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'HarnessPlayground-2026-03-12-110000.ips',
      'HarnessPlayground-2026-03-12-120000.ips',
      'HarnessPlayground-2026-03-12-130000.ips',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      input: fs.PathOrFileDescriptor
    ) => {
      const filePath = String(input);
      // The newest file (130000) belongs to a different simulator; the second-newest (120000) is ours
      const udid = filePath.includes('130000') ? 'other-sim-udid' : 'sim-udid';
      const pid = filePath.includes('110000')
        ? 1001
        : filePath.includes('120000')
        ? 1002
        : 1003;

      return [
        JSON.stringify({
          app_name: 'HarnessPlayground',
          bundleID: 'com.harnessplayground',
        }),
        JSON.stringify({
          pid,
          procName: 'HarnessPlayground',
          procPath: `${homedir()}/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground`,
          exception: { type: 'EXC_BREAKPOINT', signal: 'SIGTRAP' },
        }),
      ].join('\n');
    }) as typeof fs.readFileSync);
    vi.spyOn(fs, 'statSync').mockImplementation(((input: fs.PathLike) => {
      const filePath = String(input);
      const mtimeMs = filePath.includes('110000')
        ? Date.parse('2026-03-12T11:00:00.000Z')
        : filePath.includes('120000')
        ? Date.parse('2026-03-12T12:00:00.000Z')
        : Date.parse('2026-03-12T13:00:00.000Z');

      return { mtimeMs } as fs.Stats;
    }) as typeof fs.statSync);

    const reports = await collectCrashReports({
      udid: 'sim-udid',
      bundleId: 'com.harnessplayground',
      processNames: ['HarnessPlayground'],
    });

    expect(reports).toHaveLength(1);
    // Skips the newest (pid 1003, other simulator) and returns the second-newest that matches
    expect(reports[0]?.pid).toBe(1002);
  });
});
