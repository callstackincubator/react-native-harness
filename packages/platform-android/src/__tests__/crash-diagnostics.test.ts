import { describe, expect, it } from 'vitest';
import {
  filterExitInfo,
  getBestDropboxArtifact,
  parseDropboxOutput,
} from '../crash-diagnostics.js';

const javaCrashDropbox = `
Drop box contents: 1 entries
Max entries: 1000
========================================
2026-03-12 10:30:45.123 data_app_crash (text, 500 bytes)
Process: com.harnessplayground
PID: 7777
Package: com.harnessplayground v1 (1.0)
java.lang.RuntimeException: boom
\tat com.harnessplayground.MainActivity.onCreate(MainActivity.kt:38)
`;

const nativeCrashDropbox = `
========================================
2026-03-12 10:31:10.456 data_app_native_crash (text, 800 bytes)
Process: com.harnessplayground
PID: 8888
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0xdeadbeef
Abort message: 'JNI DETECTED ERROR IN APPLICATION'
backtrace:
      #00 pc 00001234  /data/app/lib/libapp.so
`;

describe('parseDropboxOutput', () => {
  it('parses java and native dropbox entries', () => {
    const entries = parseDropboxOutput(`${javaCrashDropbox}\n${nativeCrashDropbox}`);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      tag: 'data_app_crash',
      pid: 7777,
    });
    expect(entries[1]).toMatchObject({
      tag: 'data_app_native_crash',
      pid: 8888,
    });
    expect(entries[1]?.content).toContain('SIGSEGV');
  });
});

describe('getBestDropboxArtifact', () => {
  it('prefers the highest-scored artifact', () => {
    const entries = parseDropboxOutput(`${javaCrashDropbox}\n${nativeCrashDropbox}`);
    const artifacts = entries.map((entry, index) => ({
      artifactType:
        entry.tag === 'data_app_native_crash'
          ? ('dropbox-native-crash' as const)
          : ('dropbox-crash' as const),
      dropboxTag: entry.tag,
      occurredAt: Date.now(),
      score: index === 0 ? 100 : 300,
      summary: entry.content,
      pid: entry.pid,
      processName: 'com.harnessplayground',
    }));

    expect(getBestDropboxArtifact(artifacts)?.dropboxTag).toBe(
      'data_app_native_crash'
    );
  });
});

describe('filterExitInfo', () => {
  it('returns matching exit-info records for the target package and pid', () => {
    const output = `
ApplicationExitInfo #0:
  package=com.harnessplayground pid=7777 realUid=10123
  reason=4 (APP CRASH(NATIVE))
  timestamp=2026-03-12 10:31:10.456
ApplicationExitInfo #1:
  package=com.other.app pid=9999 realUid=10199
  reason=10 (USER REQUESTED)
`;

    const filtered = filterExitInfo({
      output,
      bundleId: 'com.harnessplayground',
      pid: 7777,
    });

    expect(filtered).toContain('com.harnessplayground pid=7777');
    expect(filtered).not.toContain('com.other.app');
  });

  it('returns null when no exit-info records exist', () => {
    expect(
      filterExitInfo({
        output: 'No exit info records for com.harnessplayground',
        bundleId: 'com.harnessplayground',
      })
    ).toBeNull();
  });
});
