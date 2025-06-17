import { ChildProcess, exec } from 'node:child_process';

export type AndroidEmulatorStatus = 'running' | 'loading' | 'stopped';

export const getEmulatorNameFromId = async (
  emulatorId: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    exec(`adb -s ${emulatorId} emu avd name`, (error: any, stdout: string) => {
      if (error) {
        resolve(null);
        return;
      }

      const avdName = stdout.split('\n')[0].trim();
      resolve(avdName || null);
    });
  });
};

export const getEmulatorDeviceId = async (
  avdName: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    exec('adb devices', async (error: any, stdout: string) => {
      if (error) {
        resolve(null);
        return;
      }

      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split('\t');
        if (parts.length === 2 && parts[0].startsWith('emulator-')) {
          const emulatorId = parts[0].trim();

          const name = await getEmulatorNameFromId(emulatorId);
          if (name === avdName) {
            resolve(emulatorId);
            return;
          }
        }
      }
      resolve(null);
    });
  });
};

export const getEmulatorStatus = (
  avdName: string
): Promise<AndroidEmulatorStatus> => {
  return new Promise((resolve) => {
    getEmulatorDeviceId(avdName).then((emulatorId) => {
      if (!emulatorId) {
        resolve('stopped');
        return;
      }

      // Check if device is fully booted by checking boot completion
      exec(
        `adb -s ${emulatorId} shell getprop sys.boot_completed`,
        (bootError: any, bootStdout: string) => {
          if (bootError) {
            resolve('loading');
            return;
          }

          const bootCompleted = bootStdout.trim() === '1';
          resolve(bootCompleted ? 'running' : 'loading');
        }
      );
    });
  });
};

export const runEmulator = (name: string): Promise<ChildProcess> => {
  return new Promise((resolve, reject) => {
    // Start the emulator
    const process = exec(`emulator -avd ${name}`, (error: any) => {
      if (error) {
        reject(error);
        return;
      }
    });

    // Poll for emulator status until it's fully running
    const checkStatus = async () => {
      try {
        const status = await getEmulatorStatus(name);

        if (status === 'running') {
          resolve(process);
        } else if (status === 'loading') {
          // Check again in 2 seconds
          setTimeout(checkStatus, 2000);
        } else {
          // Still stopped, check again in 1 second
          setTimeout(checkStatus, 1000);
        }
      } catch (error) {
        reject(error);
      }
    };

    // Start checking status after a brief delay to allow emulator to start
    setTimeout(checkStatus, 3000);
  });
};

export const stopEmulator = (avdName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    // First, get the emulator device ID
    getEmulatorDeviceId(avdName).then((emulatorId) => {
      if (!emulatorId) {
        resolve(); // No emulator running, nothing to stop
        return;
      }

      stopEmulatorById(emulatorId, resolve, reject);
    });
  });
};

const stopEmulatorById = (
  emulatorId: string,
  resolve: () => void,
  reject: (error: any) => void
): void => {
  // Stop the emulator using the found ID
  exec(`adb -s ${emulatorId} emu kill`, (killError: any) => {
    if (killError) {
      reject(killError);
      return;
    }
    resolve();
  });
};

export const isAppInstalled = async (
  emulatorId: string,
  bundleId: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    exec(
      `adb -s ${emulatorId} shell pm list packages ${bundleId}`,
      (error: any, stdout: string) => {
        if (error) {
          resolve(false);
          return;
        }

        const installed = stdout.trim() !== '';
        resolve(installed);
      }
    );
  });
};

export const reversePort = async (port: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    exec(`adb reverse tcp:${port} tcp:${port}`, (error: any) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const getEmulatorScreenshot = async (
  emulatorId: string,
  name: string = `${emulatorId}-${new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\//g, '-')}.png`
): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    exec(
      `adb -s ${emulatorId} exec-out screencap -p > ${name}`,
      (error: any) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(name);
      }
    );
  });
};
