import { z } from 'zod';

export const AppleSimulatorSchema = z.object({
  type: z.literal('simulator'),
  name: z.string().min(1, 'Name is required'),
  systemVersion: z.string().min(1, 'System version is required'),
});

export const ApplePhysicalDeviceSchema = z.object({
  type: z.literal('physical'),
  name: z.string().min(1, 'Name is required'),
});

export const AppleDeviceSchema = z.discriminatedUnion('type', [
  AppleSimulatorSchema,
  ApplePhysicalDeviceSchema,
]);

export const ApplePlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  device: AppleDeviceSchema,
  bundleId: z.string().min(1, 'Bundle ID is required'),
});

export type AppleSimulator = z.infer<typeof AppleSimulatorSchema>;
export type ApplePhysicalDevice = z.infer<typeof ApplePhysicalDeviceSchema>;
export type AppleDevice = z.infer<typeof AppleDeviceSchema>;
export type ApplePlatformConfig = z.infer<typeof ApplePlatformConfigSchema>;

export const isAppleDeviceSimulator = (
  device: AppleDevice
): device is AppleSimulator => {
  return device.type === 'simulator';
};

export const isAppleDevicePhysical = (
  device: AppleDevice
): device is ApplePhysicalDevice => {
  return device.type === 'physical';
};

export function assertAppleDeviceSimulator(
  device: AppleDevice
): asserts device is AppleSimulator {
  if (!isAppleDeviceSimulator(device)) {
    throw new Error('Device is not a simulator');
  }
}

export function assertAppleDevicePhysical(
  device: AppleDevice
): asserts device is ApplePhysicalDevice {
  if (!isAppleDevicePhysical(device)) {
    throw new Error('Device is not a physical device');
  }
}
