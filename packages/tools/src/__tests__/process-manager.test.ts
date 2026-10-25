import { describe, expect, it } from 'vitest';
import {
  getProcessManager,
  runWithHarnessContext,
} from '../harness-context.js';
import { runCommand, spawn, SubprocessError } from '../spawn.js';
import {
  createFakeProcessManager,
  createInMemoryFileSystem,
} from '../testing.js';
import { getFs } from '../harness-context.js';

const runOptions = () => ({
  signal: new AbortController().signal,
  timeoutMs: 1000,
});

describe('getProcessManager', () => {
  it('returns a real manager by default', async () => {
    const result = await getProcessManager().spawn(process.execPath, [
      '-e',
      "console.log('hi')",
    ]);
    expect(result.stdout).toBe('hi');
  });

  it('routes spawn() and runCommand() through the context manager', async () => {
    const fake = createFakeProcessManager();
    fake.on('tool', ['a'], { stdout: 'one' });
    fake.on('tool', ['b'], { stdout: 'two' });

    await runWithHarnessContext({ process: fake }, async () => {
      expect((await spawn('tool', ['a'])).stdout).toBe('one');
      expect((await runCommand('tool', ['b'], runOptions())).stdout).toBe(
        'two'
      );
    });

    expect(fake.calls.map((call) => call.args)).toEqual([['a'], ['b']]);
    expect(fake.calls[1].options).toMatchObject({ timeout: 1000 });
  });

  it('falls back to defaults for missing context fields', () => {
    const fs = createInMemoryFileSystem();
    const fake = createFakeProcessManager();
    runWithHarnessContext({ fs }, () => {
      expect(getFs()).toBe(fs);
      expect(getProcessManager()).not.toBe(fake);
      expect(typeof getProcessManager().spawn).toBe('function');
    });
    runWithHarnessContext({ process: fake }, () => {
      expect(getProcessManager()).toBe(fake);
      expect(getFs()).not.toBe(fs);
    });
  });

  it('inherits fields from the enclosing context when nested', () => {
    const fs = createInMemoryFileSystem();
    const fake = createFakeProcessManager();
    runWithHarnessContext({ fs }, () => {
      runWithHarnessContext({ process: fake }, () => {
        expect(getFs()).toBe(fs);
        expect(getProcessManager()).toBe(fake);
      });
    });
  });
});

describe('createFakeProcessManager', () => {
  it('matches by exact args or predicate, latest registration wins', async () => {
    const fake = createFakeProcessManager()
      .on('git', ['status'], { stdout: 'exact' })
      .on(
        'git',
        (args) => args[0] === 'log',
        ({ args }) => ({
          stdout: args.join(','),
        })
      )
      .on('git', ['status'], { stdout: 'newer' });

    expect((await fake.spawn('git', ['status'])).stdout).toBe('newer');
    expect((await fake.spawn('git', ['log', '-1'])).stdout).toBe('log,-1');
  });

  it('consumes once handlers', async () => {
    const fake = createFakeProcessManager()
      .on('x', [], { stdout: 'base' })
      .on('x', [], { stdout: 'first' }, { once: true });
    expect((await fake.spawn('x')).stdout).toBe('first');
    expect((await fake.spawn('x')).stdout).toBe('base');
  });

  it('rejects unmatched commands with a clear message', async () => {
    const fake = createFakeProcessManager();
    await expect(fake.spawn('nope', ['1'])).rejects.toThrow(
      'no handler registered for command: nope 1'
    );
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects with a SubprocessError on non-zero exit', async () => {
    const fake = createFakeProcessManager().on('f', [], {
      stdout: 'out',
      stderr: 'err',
      exitCode: 2,
    });
    const error = await fake.spawn('f').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubprocessError);
    expect(error).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 2 });
  });

  it('returns a full result and supports async iteration', async () => {
    const fake = createFakeProcessManager().on('f', [], {
      stdout: 'a\nb\n',
      stderr: 'e',
    });
    const result = await fake.spawn('f');
    expect(result).toMatchObject({
      stdout: 'a\nb\n',
      stderr: 'e',
      command: 'f',
    });
    expect(typeof result.durationMs).toBe('number');

    const collect = async (iterable: AsyncIterable<string>) => {
      const lines: string[] = [];
      for await (const line of iterable) lines.push(line);
      return lines;
    };
    expect(await collect(fake.spawn('f'))).toEqual(['a', 'b', 'e']);
    expect(await collect(fake.spawn('f').stdout)).toEqual(['a', 'b']);
    expect(await collect(fake.spawn('f').stderr)).toEqual(['e']);
    expect(await fake.spawn('f').nodeChildProcess).toBeDefined();
  });
});
