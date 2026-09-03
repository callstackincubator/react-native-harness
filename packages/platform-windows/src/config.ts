import { z } from 'zod';

export const WindowsAppLaunchOptionsSchema = z.object({});

export const WindowsPlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  /**
   * The app's `Identity/@Name` from `Package.appxmanifest` — e.g.
   * `ReactNativeNitroExample`. Used to look the deployed package up with
   * `Get-AppxPackage`.
   */
  packageName: z.string().min(1, 'packageName is required'),
  /**
   * The app's `Application/@Id` from `Package.appxmanifest`. Combined with the
   * package family name into the AUMID used to launch the app. Defaults to
   * `App`, which is what the React Native Windows template generates.
   */
  appId: z.string().min(1).optional().default('App'),
  /**
   * The name of the app's process (without `.exe`), for tracking whether it is
   * still running. Defaults to `packageName`, which is correct for the RNW
   * template.
   */
  processName: z.string().min(1).optional(),
  appLaunchOptions: WindowsAppLaunchOptionsSchema.optional(),
});

export type WindowsAppLaunchOptions = z.infer<
  typeof WindowsAppLaunchOptionsSchema
>;
export type WindowsPlatformConfig = z.infer<typeof WindowsPlatformConfigSchema>;

/** The `WindowsPlatformConfig` before Zod applies defaults (e.g. `appId`). */
export type WindowsPlatformConfigInput = z.input<
  typeof WindowsPlatformConfigSchema
>;
