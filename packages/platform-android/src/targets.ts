import { RunTarget } from "@react-native-harness/platforms";
import * as adb from './adb.js';

export const getRunTargets = async (): Promise<RunTarget[]> => {
  const [avds, connectedDevices] = await Promise.all([
    adb.getAvds(),
    adb.getConnectedDevices(),
  ]);

  const targets: RunTarget[] = [];

  for (const avd of avds) {
    targets.push({
      type: 'emulator',
      name: avd,
      platform: 'android',
      description: 'Android emulator',
	  device: {
		name: avd,
	  },
    });
  }

  for (const device of connectedDevices) {
    targets.push({
      type: 'physical',
      name: `${device.manufacturer} ${device.model}`,
      platform: 'android',
      description: `Physical device (${device.id})`,
	  device: {
		manufacturer: device.manufacturer,
		model: device.model,
	  },
    });
  }

  return targets;
};
