import { spawn } from '@react-native-harness/tools';

export type IOSSimulatorStatus = 'stopped' | 'loading' | 'running';

export const getSimulatorDeviceId = async (
  simulatorName: string
): Promise<string | null> => {
  try {
    const { stdout } = await spawn('xcrun', [
      'simctl',
      'list',
      'devices',
      '--json',
    ]);
    const devices = JSON.parse(stdout);

    // Find the device across all iOS versions
    for (const runtime in devices.devices) {
      if (runtime.includes('iOS')) {
        const runtimeDevices = devices.devices[runtime];
        const device = runtimeDevices.find(
          (d: any) => d.name === simulatorName
        );

        if (device) {
          return device.udid;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const getAvailableSimulators = async (): Promise<
  Array<{ name: string; udid: string; runtime: string }>
> => {
  try {
    const { stdout } = await spawn('xcrun', [
      'simctl',
      'list',
      'devices',
      '--json',
    ]);
    const devices = JSON.parse(stdout);
    const simulators: Array<{
      name: string;
      udid: string;
      runtime: string;
    }> = [];

    for (const runtime in devices.devices) {
      if (runtime.includes('iOS')) {
        const runtimeDevices = devices.devices[runtime];
        runtimeDevices.forEach((device: any) => {
          if (device.isAvailable) {
            simulators.push({
              name: device.name,
              udid: device.udid,
              runtime: runtime,
            });
          }
        });
      }
    }

    return simulators;
  } catch {
    return [];
  }
};

export const getSimulatorStatus = async (
  simulatorName: string
): Promise<IOSSimulatorStatus> => {
  try {
    const { stdout } = await spawn('xcrun', [
      'simctl',
      'list',
      'devices',
      '--json',
    ]);
    const devices = JSON.parse(stdout);

    for (const runtime in devices.devices) {
      if (runtime.includes('iOS')) {
        const runtimeDevices = devices.devices[runtime];
        const device = runtimeDevices.find(
          (d: any) => d.name === simulatorName
        );

        if (device) {
          switch (device.state) {
            case 'Booted':
              return 'running';
            case 'Booting':
              return 'loading';
            default:
              return 'stopped';
          }
        }
      }
    }

    return 'stopped';
  } catch {
    return 'stopped';
  }
};

export const runSimulator = async (name: string): Promise<void> => {
  const deviceId = await getSimulatorDeviceId(name);

  if (!deviceId) {
    throw new Error('Simulator not found');
  }

  try {
    await spawn('xcrun', ['simctl', 'boot', deviceId]);
  } catch (bootError: any) {
    // Ignore if simulator is already booted
    if (
      !bootError.stderr?.includes(
        'Unable to boot device in current state: Booted'
      )
    ) {
      throw bootError;
    }
  }

  await spawn('open', ['-a', 'Simulator']);

  let attempts = 0;

  while (true) {
    attempts++;

    const status = await getSimulatorStatus(name);

    if (status === 'running') {
      break;
    }

    if (attempts > 10) {
      throw new Error('Simulator not running');
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

export const stopSimulator = async (name: string): Promise<void> => {
  const simulatorId = await getSimulatorDeviceId(name);

  if (!simulatorId) {
    return; // Already stopped
  }

  await stopSimulatorById(simulatorId);
};

const stopSimulatorById = async (simulatorId: string): Promise<void> => {
  try {
    await spawn('xcrun', ['simctl', 'shutdown', simulatorId]);
  } catch (shutdownError: any) {
    // Ignore if simulator is already shut down
    if (
      !shutdownError.stderr?.includes(
        'Unable to shutdown device in current state: Shutdown'
      )
    ) {
      throw shutdownError;
    }
  }
};
