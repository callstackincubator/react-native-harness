import { describe, expect, it } from 'vitest';
import { spawnOwnedProcess } from '../owned-process.js';

describe('spawnOwnedProcess', () => {
  it('kills an owned child exactly once and shares concurrent disposal', async () => {
    const ownedProcess = spawnOwnedProcess(globalThis.process.execPath, [
      '-e',
      "process.stdout.write('ready\\n'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)",
    ]);
    await ownedProcess.subprocess.nodeChildProcess;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const firstDispose = ownedProcess.dispose();
    const secondDispose = ownedProcess.dispose();

    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
  });
});
