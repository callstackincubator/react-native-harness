import {
  type AppMonitor,
  type AppMonitorEvent,
  DeviceNotFoundError,
  AppNotInstalledError,
  type CreateAppMonitorOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { getEmitter } from '@react-native-harness/tools';
import { VegaPlatformConfigSchema, type VegaPlatformConfig } from './config.js';
import * as kepler from './kepler.js';

const createPollingAppMonitor = ({
  interval,
  isAppRunning,
}: {
  interval: number;
  isAppRunning: () => Promise<boolean>;
}): AppMonitor => {
  const emitter = getEmitter<AppMonitorEvent>();
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let wasRunning = false;

  const start = async () => {
    if (started) {
      return;
    }

    started = true;
    wasRunning = await isAppRunning();

    timer = setInterval(async () => {
      const running = await isAppRunning();

      if (running && !wasRunning) {
        emitter.emit({ type: 'app_started', source: 'polling' });
      } else if (!running && wasRunning) {
        emitter.emit({ type: 'app_exited', source: 'polling' });
      }

      wasRunning = running;
    }, interval);
  };

  const stop = async () => {
    started = false;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const dispose = async () => {
    await stop();
    emitter.clearAllListeners();
  };

  return {
    start,
    stop,
    dispose,
    addListener: emitter.addListener,
    removeListener: emitter.removeListener,
  };
};

const getVegaRunner = async (
  config: VegaPlatformConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = VegaPlatformConfigSchema.parse(config);
  const deviceId = parsedConfig.device.deviceId;
  const bundleId = parsedConfig.bundleId;
  const deviceStatus = await kepler.getVegaDeviceStatus(deviceId);

  if (deviceStatus === 'stopped') {
    throw new DeviceNotFoundError(deviceId);
  }

  const isInstalled = await kepler.isAppInstalled(deviceId, bundleId);

  if (!isInstalled) {
    throw new AppNotInstalledError(bundleId, deviceId);
  }

  return {
    startApp: async () => {
      await kepler.startApp(deviceId, bundleId);
    },
    restartApp: async () => {
      await kepler.stopApp(deviceId, bundleId);
      await kepler.startApp(deviceId, bundleId);
    },
    stopApp: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
    dispose: async () => {
      await kepler.stopApp(deviceId, bundleId);
    },
    isAppRunning: async () => {
      return await kepler.isAppRunning(deviceId, bundleId);
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    createAppMonitor: (_options?: CreateAppMonitorOptions) =>
      createPollingAppMonitor({
        interval: 250,
        isAppRunning: () => kepler.isAppRunning(deviceId, bundleId),
      }),
  };
};

export default getVegaRunner;
