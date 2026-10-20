import { describe, expect, it } from 'vitest';
import { runCommand, spawn, SubprocessError } from '../spawn.js';

describe('runCommand', () => {
  it('uses SIGKILL when a deadline expires', async () => {
    const command = runCommand(globalThis.process.execPath, [
      '-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)",
    ], {
      signal: new AbortController().signal,
      timeoutMs: 50,
    });

    await expect(command).rejects.toBeDefined();
  });
});

describe('spawn', () => {
  // Build the printed text at runtime so it does not also appear in the
  // command line that the error message already contains.
  const failingScript =
    "console.log(['some', 'output'].join(' ')); console.error(['the', 'reason'].join(' ')); process.exit(1)";

  const getRejection = async (promise: PromiseLike<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('Expected the command to fail');
  };

  it('includes captured output in the message of a failed command', async () => {
    const error = await getRejection(
      spawn(globalThis.process.execPath, ['-e', failingScript])
    );

    expect(error).toBeInstanceOf(SubprocessError);
    const subprocessError = error as SubprocessError;
    const [firstLine] = subprocessError.message.split('\n');
    expect(firstLine).toMatch(/^Command failed with exit code 1: /);
    expect(subprocessError.message).toContain('the reason');
    expect(subprocessError.message).toContain('some output');
    expect(subprocessError.stack).toContain('the reason');
    expect(subprocessError.stderr).toBe('the reason');
    expect(subprocessError.stdout).toBe('some output');
    expect(subprocessError.exitCode).toBe(1);
  });

  it('does not repeat the captured output when awaited again', async () => {
    const subprocess = spawn(globalThis.process.execPath, ['-e', failingScript]);

    const first = (await getRejection(subprocess)) as SubprocessError;
    const firstMessage = first.message;
    const second = (await getRejection(subprocess)) as SubprocessError;
    await getRejection(subprocess.catch((e: unknown) => Promise.reject(e)));

    expect(second).toBe(first);
    expect(second.message).toBe(firstMessage);
    expect(second.message.split('the reason')).toHaveLength(2);
  });

  it('still yields output lines when iterated', async () => {
    const lines: string[] = [];
    for await (const line of spawn(globalThis.process.execPath, [
      '-e',
      "console.log('first'); console.log('second')",
    ])) {
      lines.push(line);
    }

    expect(lines).toEqual(['first', 'second']);
  });

  it('resolves a successful command unchanged', async () => {
    const result = await spawn(globalThis.process.execPath, [
      '-e',
      "console.log('hello')",
    ]);

    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
  });
});
