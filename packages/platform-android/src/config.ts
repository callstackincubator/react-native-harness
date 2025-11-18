import { z } from 'zod';

export const AndroidEmulatorAVDConfigSchema = z.object({
  apiLevel: z.number().min(1, 'API level is required'),
  profile: z.string().min(1, 'Profile is required'),
  diskSize: z.string().min(1, 'Disk size is required').default('1G'),
  heapSize: z.string().min(1, 'Heap size is required').default('1G'),
});

export const AndroidEmulatorSchema = z.object({
  type: z.literal('emulator'),
  name: z.string().min(1, 'AVD name is required'),
  avd: AndroidEmulatorAVDConfigSchema.optional(),
});

export const PhysicalAndroidDeviceSchema = z.object({
  type: z.literal('physical'),
  manufacturer: z.string().min(1, 'Manufacturer is required'),
  model: z.string().min(1, 'Model is required'),
});

export const AndroidDeviceSchema = z.discriminatedUnion('type', [
  AndroidEmulatorSchema,
  PhysicalAndroidDeviceSchema,
]);

export const AndroidPlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  device: AndroidDeviceSchema,
  bundleId: z.string().min(1, 'Bundle ID is required'),
  activityName: z
    .string()
    .min(1, 'Activity name is required')
    .default('.MainActivity'),
});

export type AndroidEmulator = z.infer<typeof AndroidEmulatorSchema>;
export type PhysicalAndroidDevice = z.infer<typeof PhysicalAndroidDeviceSchema>;
export type AndroidDevice = z.infer<typeof AndroidDeviceSchema>;
export type AndroidPlatformConfig = z.infer<typeof AndroidPlatformConfigSchema>;
export type AndroidEmulatorAVDConfig = z.infer<
  typeof AndroidEmulatorAVDConfigSchema
>;

export const isAndroidDeviceEmulator = (
  device: AndroidDevice
): device is AndroidEmulator => {
  return device.type === 'emulator';
};

export const isAndroidDevicePhysical = (
  device: AndroidDevice
): device is PhysicalAndroidDevice => {
  return device.type === 'physical';
};

export function assertAndroidDeviceEmulator(
  device: AndroidDevice
): asserts device is AndroidEmulator {
  if (!isAndroidDeviceEmulator(device)) {
    throw new Error('Device is not an emulator');
  }
}

export function assertAndroidDevicePhysical(
  device: AndroidDevice
): asserts device is PhysicalAndroidDevice {
  if (!isAndroidDevicePhysical(device)) {
    throw new Error('Device is not a physical device');
  }
}
