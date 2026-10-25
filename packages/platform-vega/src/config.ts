import { z } from 'zod';

export const VegaAppLaunchOptionsSchema = z.object({});

export const VegaVirtualDeviceSchema = z.object({
  type: z.literal('emulator'),
  /**
   * Device name as printed by `vega device list`. The Vega Virtual Device
   * shows up as `VirtualDevice`, which is the default.
   */
  deviceId: z.string().min(1).optional().default('VirtualDevice'),
});

export const VegaPhysicalDeviceSchema = z.object({
  type: z.literal('physical'),
  /**
   * Device serial number (DSN) as printed by `vega device list` once the
   * Fire TV is in developer mode.
   */
  serial: z.string().min(1, 'Device serial number is required'),
});

export const VegaDeviceSchema = z.discriminatedUnion('type', [
  VegaVirtualDeviceSchema,
  VegaPhysicalDeviceSchema,
]);

export const VegaPlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  device: VegaDeviceSchema,
  /** The `[package] id` from `manifest.toml`. Only used to derive `componentId`. */
  bundleId: z.string().min(1, 'Bundle ID is required'),
  /**
   * The interactive component id from `manifest.toml`. The Vega CLI identifies
   * the app by it for install checks, launching and tracking. Defaults to `<bundleId>.main`, which is what the Vega templates
   * generate.
   */
  componentId: z.string().min(1).optional(),
  /**
   * Build variant of the package in `HARNESS_APP_PATH`. Harness loads the
   * bundle from Metro, which needs a Debug package.
   */
  buildType: z.enum(['Debug', 'Release']).optional().default('Debug'),
  appLaunchOptions: VegaAppLaunchOptionsSchema.optional(),
});

export type VegaVirtualDevice = z.infer<typeof VegaVirtualDeviceSchema>;
export type VegaPhysicalDevice = z.infer<typeof VegaPhysicalDeviceSchema>;
export type VegaDevice = z.infer<typeof VegaDeviceSchema>;
export type VegaDeviceInput = z.input<typeof VegaDeviceSchema>;
export type VegaPlatformConfig = z.infer<typeof VegaPlatformConfigSchema>;

/** The `VegaPlatformConfig` before Zod applies defaults. */
export type VegaPlatformConfigInput = z.input<typeof VegaPlatformConfigSchema>;

/** @deprecated Use `VegaVirtualDevice`. */
export type VegaEmulator = VegaVirtualDevice;

export const getVegaComponentId = (config: VegaPlatformConfig): string =>
  config.componentId ?? `${config.bundleId}.main`;
