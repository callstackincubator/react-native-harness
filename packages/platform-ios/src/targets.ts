import * as simctl from './xcrun/simctl.js';
import * as devicectl from './xcrun/devicectl.js';
import type { RunTarget } from '@react-native-harness/platforms';

export const getRunTargets = async (): Promise<RunTarget[]> => {
  const [simulators, physicalDevices] = await Promise.all([
    simctl.getSimulators().catch(() => [] as simctl.AppleSimulatorInfo[]),
    devicectl.listDevices().catch(() => [] as devicectl.AppleDeviceInfo[]),
  ]);

  const targets: RunTarget[] = [];

  for (const simulator of simulators) {
    if (!simulator.isAvailable) continue;

    // runtime example: com.apple.CoreSimulator.SimRuntime.iOS-17-5
    const systemVersion =
      simulator.runtime
        .split('.')
        .pop()
        ?.replace('iOS-', '')
        .replace(/-/g, '.') ?? 'Unknown';

    targets.push({
      type: 'emulator',
      name: simulator.name,
      platform: 'ios',
      description: `iOS ${systemVersion}`,
	  device: {
		name: simulator.name,
		systemVersion: systemVersion,
	  },
    });
  }

  for (const device of physicalDevices) {
    targets.push({
      type: 'physical',
      name: device.deviceProperties.name,
      platform: 'ios',
      description: `Physical device (${device.deviceProperties.osVersionNumber})`,
	  device: {
		name: device.deviceProperties.name,
	  },
    });
  }

  return targets;
};
