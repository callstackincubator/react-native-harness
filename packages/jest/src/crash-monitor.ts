import { HarnessPlatformRunner } from '@react-native-harness/platforms';
import { BridgeServer } from '@react-native-harness/bridge/server';
import { NativeCrashError } from './errors.js';
import { logger } from '@react-native-harness/tools';

export type CrashMonitor = {
  startMonitoring(testFilePath: string): Promise<never>;
  stopMonitoring(): void;
  markIntentionalRestart(): void;
  clearIntentionalRestart(): void;
  dispose(): void;
};

export type CrashMonitorOptions = {
  interval: number;
  platformRunner: HarnessPlatformRunner;
  bridgeServer: BridgeServer;
};

export const createCrashMonitor = ({
  interval,
  platformRunner,
  bridgeServer,
}: CrashMonitorOptions): CrashMonitor => {
  let pollingInterval: NodeJS.Timeout | null = null;
  let isIntentionalRestart = false;
  let currentTestFilePath: string | null = null;
  let rejectFn: ((error: NativeCrashError) => void) | null = null;

  const handleDisconnect = () => {
    // Verify if it's actually a crash by checking if app is still running
    if (!isIntentionalRestart && currentTestFilePath) {
      // Capture the value to avoid it being null when setTimeout callback runs
      const testFilePath = currentTestFilePath;
      logger.debug('Bridge disconnected, checking if app crashed');
      // Use a slight delay to allow the OS to clean up the process
      setTimeout(async () => {
        const isRunning = await platformRunner.isAppRunning();
        if (!isRunning && !isIntentionalRestart && rejectFn) {
          logger.debug(`Native crash detected during: ${testFilePath}`);
          rejectFn(new NativeCrashError(testFilePath));
        }
      }, 100);
    }
  };

  const startMonitoring = (testFilePath: string): Promise<never> => {
    currentTestFilePath = testFilePath;

    return new Promise<never>((_, reject) => {
      rejectFn = reject;

      // Listen for bridge disconnect as early indicator
      bridgeServer.on('disconnect', handleDisconnect);

      // Poll for app running status
      pollingInterval = setInterval(async () => {
        // Skip check during intentional restarts
        if (isIntentionalRestart) {
          return;
        }

        try {
          const isRunning = await platformRunner.isAppRunning();

          if (!isRunning && currentTestFilePath) {
            logger.debug(
              `Native crash detected during: ${currentTestFilePath}`
            );
            stopMonitoring();
            reject(new NativeCrashError(currentTestFilePath));
          }
        } catch (error) {
          logger.error('Error checking app status:', error);
        }
      }, interval);
    });
  };

  const stopMonitoring = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    bridgeServer.off('disconnect', handleDisconnect);
    currentTestFilePath = null;
    rejectFn = null;
  };

  const markIntentionalRestart = () => {
    isIntentionalRestart = true;
  };

  const clearIntentionalRestart = () => {
    isIntentionalRestart = false;
  };

  const dispose = () => {
    stopMonitoring();
  };

  return {
    startMonitoring,
    stopMonitoring,
    markIntentionalRestart,
    clearIntentionalRestart,
    dispose,
  };
};
