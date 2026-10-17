import { z } from 'zod';

export const AppleAppLaunchOptionsSchema = z.object({
  arguments: z.array(z.string()).optional(),
  environment: z.record(z.string()).optional(),
});

export const AppleSimulatorSchema = z.object({
  type: z.literal('simulator'),
  name: z.string().min(1, 'Name is required'),
  systemVersion: z.string().min(1, 'System version is required'),
});

export const ApplePhysicalDeviceCodeSignSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  signingIdentity: z.string().optional(),
  provisioningProfile: z.string().optional(),
  /**
   * Reverse-DNS prefix the shipped artifact's bundle ids are rewritten to before
   * signing. Needed when the account's profile covers only its own identifiers
   * and cannot cover `com.callstackincubator.*`; the profile must cover the
   * remapped ids, e.g. `com.example.app.HarnessXCTestAgent`. Applies to the
   * shipped artifact only: a locally built agent keeps the shipped ids, because
   * `xcodebuild` cannot override one target's id without changing the other's.
   */
  bundleIdPrefix: z
    .string()
    .min(1, 'Bundle ID prefix is required')
    .regex(
      /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/,
      'Bundle ID prefix must be a reverse-DNS prefix such as "com.example.app"'
    )
    .optional(),
});

export const ApplePhysicalDeviceSchema = z.object({
  type: z.literal('physical'),
  name: z.string().min(1, 'Name is required'),
  codeSign: ApplePhysicalDeviceCodeSignSchema.optional(),
});

export const AppleDeviceSchema = z.discriminatedUnion('type', [
  AppleSimulatorSchema,
  ApplePhysicalDeviceSchema,
]);

export const ApplePlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  device: AppleDeviceSchema,
  bundleId: z.string().min(1, 'Bundle ID is required'),
  appLaunchOptions: AppleAppLaunchOptionsSchema.optional(),
});

export type AppleSimulator = z.infer<typeof AppleSimulatorSchema>;
export type ApplePhysicalDeviceCodeSign = z.infer<typeof ApplePhysicalDeviceCodeSignSchema>;
export type ApplePhysicalDevice = z.infer<typeof ApplePhysicalDeviceSchema>;
export type AppleDevice = z.infer<typeof AppleDeviceSchema>;
export type ApplePlatformConfig = z.infer<typeof ApplePlatformConfigSchema>;
export type AppleAppLaunchOptions = z.infer<typeof AppleAppLaunchOptionsSchema>;

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
