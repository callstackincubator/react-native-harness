import { type ChildProcess } from 'node:child_process';

export const killWithAwait = (child: ChildProcess): Promise<void> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve();
    }, 10000);

    if (child.killed || child.exitCode !== null) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    child.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.on('error', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      child.kill();
    } catch (error) {
      clearTimeout(timeout);
      resolve();
    }
  });
};
