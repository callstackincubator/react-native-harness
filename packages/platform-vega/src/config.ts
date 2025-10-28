import { z } from 'zod';

export const VegaEmulatorSchema = z.object({
  type: z.literal('emulator'),
  deviceId: z
    .string()
    .min(
      1,
      'Virtual device instance name is required (e.g., "VegaTV_1", "VegaTV_Debug")'
    ),
});

export const VegaDeviceSchema = z.discriminatedUnion('type', [
  VegaEmulatorSchema,
]);

export const VegaPlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  device: VegaDeviceSchema,
  bundleId: z.string().min(1, 'Bundle ID is required'),
});

export type VegaEmulator = z.infer<typeof VegaEmulatorSchema>;
export type VegaDevice = z.infer<typeof VegaDeviceSchema>;
export type VegaPlatformConfig = z.infer<typeof VegaPlatformConfigSchema>;

export const isVegaDeviceEmulator = (
  device: VegaDevice
): device is VegaEmulator => {
  return device.type === 'emulator';
};

export function assertVegaDeviceEmulator(
  device: VegaDevice
): asserts device is VegaEmulator {
  if (!isVegaDeviceEmulator(device)) {
    throw new Error('Device is not an emulator');
  }
}
