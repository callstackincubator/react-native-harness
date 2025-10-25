import { spawn } from '@react-native-harness/tools';
import * as adb from './adb.js';

export type AndroidEmulator = {
  adbId: string;
  stop: () => Promise<void>;
};

export const runEmulator = async (
  avdName: string
): Promise<AndroidEmulator> => {
  const process = spawn('emulator', ['-avd', avdName]);
  await process.nodeChildProcess;

  const adbId = await adb.getEmulatorName(avdName);

  if (!adbId) {
    throw new Error('Emulator not found');
  }

  // Poll for emulator status until it's fully running
  const checkStatus = async (): Promise<void> => {
    const status = await adb.isBootCompleted(adbId);

    if (!status) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await checkStatus();
    }
  };

  // Start checking status after a brief delay to allow emulator to start
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await checkStatus();

  return {
    adbId,
    stop: async () => {
      await adb.stopEmulator(adbId);
    },
  };
};
