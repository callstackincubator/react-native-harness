import { describe, expect, it } from 'vitest';
import { runCommand } from '../spawn.js';

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
