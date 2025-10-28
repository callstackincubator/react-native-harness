import { spawn } from '@react-native-harness/tools';

export type VegaVirtualDeviceStatus = 'running' | 'stopped';

/**
 * List all available Vega virtual devices
 * Returns array of device identifiers that can be used with kepler commands
 */
export const listVegaDevices = async (): Promise<string[]> => {
  try {
    const { stdout } = await spawn('kepler', ['device', 'list']);
    const lines = stdout.trim().split('\n');
    const devices: string[] = [];

    for (const line of lines) {
      if (line.trim()) {
        // Parse device line format: "VirtualDevice : tv - x86_64 - OS - hostname"
        // or potentially "VegaTV_1 : tv - x86_64 - OS - hostname" for named instances
        const deviceId = line.split(' : ')[0].trim();
        if (
          deviceId &&
          (deviceId === 'VirtualDevice' || deviceId.startsWith('Vega'))
        ) {
          devices.push(deviceId);
        }
      }
    }

    return devices;
  } catch {
    return [];
  }
};

/**
 * Check if a specific Vega virtual device is connected/available
 */
export const isVegaDeviceConnected = async (
  deviceId: string
): Promise<boolean> => {
  try {
    const { stdout } = await spawn('kepler', [
      'device',
      'is-connected',
      '--device',
      deviceId,
    ]);
    return stdout.includes('is connected');
  } catch {
    return false;
  }
};

/**
 * Launch an already installed app on specified Vega virtual device
 */
export const startApp = async (
  deviceId: string,
  bundleId: string
): Promise<void> => {
  await spawn('kepler', [
    'device',
    'launch-app',
    '--device',
    deviceId,
    '--appName',
    bundleId,
  ]);
};

/**
 * Check if an app is installed on the specified Vega virtual device
 */
export const isAppInstalled = async (
  deviceId: string,
  bundleId: string
): Promise<boolean> => {
  try {
    await spawn('kepler', [
      'device',
      'is-app-installed',
      '--device',
      deviceId,
      '--appName',
      bundleId,
    ]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if an app is currently running on the specified Vega virtual device
 */
export const isAppRunning = async (
  deviceId: string,
  bundleId: string
): Promise<boolean> => {
  try {
    await spawn('kepler', [
      'device',
      'is-app-running',
      '--device',
      deviceId,
      '--appName',
      bundleId,
    ]);
    return true;
  } catch {
    return false;
  }
};

export const stopApp = async (
  deviceId: string,
  bundleId: string
): Promise<void> => {
  await spawn('kepler', [
    'device',
    'terminate-app',
    '--device',
    deviceId,
    '--appName',
    bundleId,
  ]);
};

/**
 * Start port forwarding for debugging on specified Vega virtual device
 */
export const startPortForwarding = async (
  deviceId: string,
  port: number,
  forward = true
): Promise<void> => {
  await spawn('kepler', [
    'device',
    'start-port-forwarding',
    '--device',
    deviceId,
    '--port',
    port.toString(),
    '--forward',
    forward.toString(),
  ]);
};

/**
 * Stop port forwarding on specified Vega virtual device
 */
export const stopPortForwarding = async (
  deviceId: string,
  port: number,
  forward = true
): Promise<void> => {
  await spawn('kepler', [
    'device',
    'stop-port-forwarding',
    '--device',
    deviceId,
    '--port',
    port.toString(),
    '--forward',
    forward.toString(),
  ]);
};

/**
 * Get status of a specific Vega virtual device
 * Note: Vega CLI might manage virtual devices globally, so this checks if the device is available
 */
export const getVegaDeviceStatus = async (
  deviceId: string
): Promise<VegaVirtualDeviceStatus> => {
  try {
    // First check if the device is connected/available
    const isConnected = await isVegaDeviceConnected(deviceId);
    if (isConnected) {
      return 'running';
    }

    // Check general virtual device status
    const { stdout } = await spawn('kepler', ['virtual-device', 'status']);
    // Parse the status output to determine if VVD is running
    return stdout.toLowerCase().includes('running') ||
      stdout.toLowerCase().includes('ready')
      ? 'running'
      : 'stopped';
  } catch {
    return 'stopped';
  }
};
