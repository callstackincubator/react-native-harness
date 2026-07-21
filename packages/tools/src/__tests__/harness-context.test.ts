import { describe, expect, it } from 'vitest';
import {
  getFs,
  runWithHarnessContext,
  type FileSystem,
} from '../harness-context.js';

const createFileSystem = (): FileSystem =>
  ({
  appendFileSync: () => undefined,
  copyFileSync: () => undefined,
  createWriteStream: () => undefined as never,
  existsSync: () => false,
  mkdirSync: () => undefined,
  mkdtempSync: () => '/tmp/harness',
  readFileSync: () => 'fake file',
  readdirSync: () => [],
  realpathSync: () => '/tmp/harness',
  renameSync: () => undefined,
  rmSync: () => undefined,
  statSync: () => undefined as never,
  unlinkSync: () => undefined,
  utimesSync: () => undefined,
  writeFileSync: () => undefined,
  access: async () => undefined,
  cp: async () => undefined,
  mkdir: async () => undefined,
  mkdtemp: async () => '/tmp/harness',
  readFile: async () => Buffer.from('fake file'),
  readdir: async () => [],
  rename: async () => undefined,
  rm: async () => undefined,
  stat: async () => undefined as never,
    writeFile: async () => undefined,
  }) as unknown as FileSystem;

describe('HarnessContext filesystem', () => {
  it('uses the injected filesystem across async work', async () => {
    const fs = createFileSystem();

    await runWithHarnessContext({ fs }, async () => {
      await Promise.resolve();

      expect(getFs()).toBe(fs);
      expect(getFs().readFileSync('/file', 'utf8')).toBe('fake file');
    });
  });

  it('falls back to the real filesystem outside an injected context', () => {
    expect(getFs().existsSync(__filename)).toBe(true);
  });
});
