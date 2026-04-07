import { describe, expect, it, vi } from 'vitest';
import { iosCrashParser } from '../crash-parser.js';
import fs from 'node:fs';

describe('iosCrashParser.parse', () => {
  it('parses .crash report contents into a crash details object', () => {
    const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({
      mtimeMs: 123456,
    } as fs.Stats);

    expect(
      iosCrashParser.parse({
        path: '/tmp/HarnessPlayground.crash',
        contents: [
          'Process:               HarnessPlayground [1234]',
          'Exception Type:        EXC_CRASH (SIGABRT)',
          'Triggered by Thread:  0',
          '',
          'Thread 0 Crashed:',
          '0   HarnessPlayground                  0x0000000100000000 AppDelegate.crashIfRequested() + 20',
          '',
        ].join('\n'),
      })
    ).toEqual({
      occurredAt: 123456,
      signal: 'SIGABRT',
      exceptionType: 'EXC_CRASH (SIGABRT)',
      processName: 'HarnessPlayground',
      pid: 1234,
      rawLines: expect.any(Array),
      stackTrace: [
        '0   HarnessPlayground                  0x0000000100000000 AppDelegate.crashIfRequested() + 20',
      ],
    });

    statSpy.mockRestore();
  });

  it('parses .ips report contents into a crash details object', () => {
    const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({
      mtimeMs: 7890,
    } as fs.Stats);

    expect(
      iosCrashParser.parse({
        path: '/tmp/HarnessPlayground.ips',
        contents: [
          JSON.stringify({
            app_name: 'HarnessPlayground',
            bundleID: 'com.harnessplayground',
            name: 'HarnessPlayground',
            timestamp: '2026-03-12 11:35:08 +0000',
          }),
          JSON.stringify({
            pid: 1234,
            procName: 'HarnessPlayground',
            procPath:
              '/Users/me/Library/Developer/CoreSimulator/Devices/sim-udid/data/Containers/Bundle/Application/ABC/HarnessPlayground.app/HarnessPlayground',
            faultingThread: 0,
            threads: [
              {
                frames: [
                  {
                    symbol: 'AppDelegate.crashIfRequested()',
                    sourceFile: 'AppDelegate.swift',
                    sourceLine: 31,
                    imageIndex: 0,
                  },
                ],
              },
            ],
            usedImages: [{ name: 'HarnessPlayground' }],
            exception: {
              type: 'EXC_BREAKPOINT',
              signal: 'SIGTRAP',
            },
          }),
        ].join('\n'),
      })
    ).toMatchObject({
      occurredAt: Date.parse('2026-03-12T11:35:08.000Z'),
      signal: 'SIGTRAP',
      exceptionType: 'EXC_BREAKPOINT',
      bundleId: 'com.harnessplayground',
      processName: 'HarnessPlayground',
      pid: 1234,
      targetId: 'sim-udid',
    });

    statSpy.mockRestore();
  });
});
