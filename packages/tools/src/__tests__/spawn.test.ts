import { describe, expect, it } from 'vitest';
import { spawnStreaming } from '../spawn.js';

describe('spawnStreaming', () => {
  it('streams a chatty long-lived process without accumulating its output in memory', async () => {
    const lineCount = 20_000;
    const lineLength = 200;
    // Every line is `lineLength` "a" characters followed by a newline.
    const totalExpectedBytes = lineCount * (lineLength + 1);

    const script = `
      for (let i = 0; i < ${lineCount}; i++) {
        process.stdout.write('a'.repeat(${lineLength}) + '\\n');
      }
    `;

    const subprocess = spawnStreaming(process.execPath, ['-e', script]);
    const childProcess = await subprocess.nodeChildProcess;

    // Unlike nano-spawn's `spawn`, which always attaches a synchronous
    // 'data' listener that appends every chunk into a string for the
    // lifetime of the process, `spawnStreaming` attaches none: nothing
    // accumulates unless the caller explicitly consumes the stream.
    expect(childProcess.stdout?.listenerCount('data')).toBe(0);
    expect(childProcess.stderr?.listenerCount('data')).toBe(0);

    let bytesReceived = 0;
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
    });

    const result = await subprocess;

    // Resolves like a plain completion signal, not a `Result` carrying
    // `stdout`/`stderr`/`output` strings with the buffered content.
    expect(result).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(subprocess, 'stdout')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(subprocess, 'stderr')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(subprocess, 'output')).toBe(
      false
    );

    // The data still flowed through correctly; it just wasn't retained.
    expect(bytesReceived).toBe(totalExpectedBytes);
  });

  it('rejects when the process exits with a non-zero exit code', async () => {
    const subprocess = spawnStreaming(process.execPath, [
      '-e',
      'process.exit(2)',
    ]);

    await expect(subprocess).rejects.toThrow(/exit code 2/);
  });

  it('rejects when the executable cannot be spawned', async () => {
    const subprocess = spawnStreaming('harness-definitely-not-a-real-binary');

    await expect(subprocess).rejects.toThrow();
  });
});
