import { spawn } from '@react-native-harness/tools';
import { ChildProcess } from 'node:child_process';

export type AndroidEmulatorStatus = 'running' | 'loading' | 'stopped';

export const getEmulatorNameFromId = async (
  emulatorId: string
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('adb', ['-s', emulatorId, 'emu', 'avd', 'name']);
    const avdName = stdout.split('\n')[0].trim();
    return avdName || null;
  } catch {
    return null;
  }
};

export const getEmulatorDeviceId = async (
  avdName: string
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('adb', ['devices']);
    const lines = stdout.split('\n');

    for (const line of lines) {
      const parts = line.trim().split('\t');
      if (parts.length === 2 && parts[0].startsWith('emulator-')) {
        const emulatorId = parts[0].trim();
        const name = await getEmulatorNameFromId(emulatorId);
        if (name === avdName) {
          return emulatorId;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const getEmulatorStatus = async (
  avdName: string
): Promise<AndroidEmulatorStatus> => {
  const emulatorId = await getEmulatorDeviceId(avdName);
  if (!emulatorId) {
    return 'stopped';
  }

  try {
    // Check if device is fully booted by checking boot completion
    const { stdout } = await spawn('adb', ['-s', emulatorId, 'shell', 'getprop', 'sys.boot_completed']);
    const bootCompleted = stdout.trim() === '1';
    return bootCompleted ? 'running' : 'loading';
  } catch {
    return 'loading';
  }
};

export const runEmulator = async (name: string): Promise<ChildProcess> => {
  // Start the emulator
  const process = spawn('emulator', ['-avd', name]);
  const nodeChildProcess = await process.nodeChildProcess;

  // Poll for emulator status until it's fully running
  const checkStatus = async (): Promise<void> => {
    const status = await getEmulatorStatus(name);

    if (status === 'running') {
      return;
    } else if (status === 'loading') {
      // Check again in 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      await checkStatus();
    } else {
      // Still stopped, check again in 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      await checkStatus();
    }
  };

  // Start checking status after a brief delay to allow emulator to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  await checkStatus();

  return nodeChildProcess;
};

export const stopEmulator = async (avdName: string): Promise<void> => {
  // First, get the emulator device ID
  const emulatorId = await getEmulatorDeviceId(avdName);
  if (!emulatorId) {
    return; // No emulator running, nothing to stop
  }

  await stopEmulatorById(emulatorId);
};

const stopEmulatorById = async (emulatorId: string): Promise<void> => {
  // Stop the emulator using the found ID
  await spawn('adb', ['-s', emulatorId, 'emu', 'kill']);
};

export const isAppInstalled = async (
  emulatorId: string,
  bundleId: string
): Promise<boolean> => {
  try {
    const { stdout } = await spawn('adb', ['-s', emulatorId, 'shell', 'pm', 'list', 'packages', bundleId]);
    return stdout.trim() !== '';
  } catch {
    return false;
  }
};

export const reversePort = async (port: number): Promise<void> => {
  await spawn('adb', ['reverse', `tcp:${port}`, `tcp:${port}`]);
};

export const getEmulatorScreenshot = async (
  emulatorId: string,
  name: string = `${emulatorId}-${new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\//g, '-')}.png`
): Promise<string> => {
  // Use screencap to save directly to device, then pull the file
  const devicePath = '/sdcard/screenshot.png';

  // Take screenshot and save to device
  await spawn('adb', ['-s', emulatorId, 'shell', 'screencap', '-p', devicePath]);

  // Pull the file from device to local
  await spawn('adb', ['-s', emulatorId, 'pull', devicePath, name]);

  // Clean up the file on device
  await spawn('adb', ['-s', emulatorId, 'shell', 'rm', devicePath]);

  return name;
};
