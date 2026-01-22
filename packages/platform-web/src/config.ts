import { z } from 'zod';

export const WebBrowserConfigSchema = z.object({
  type: z.enum(['chromium', 'firefox', 'webkit']),
  url: z.string().url('A valid URL is required'),
  headless: z.boolean().default(true),
  channel: z.string().optional(),
  executablePath: z.string().optional(),
});

export const WebPlatformConfigSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  browser: WebBrowserConfigSchema,
});

export type WebBrowserConfig = z.infer<typeof WebBrowserConfigSchema>;
export type WebPlatformConfig = z.infer<typeof WebPlatformConfigSchema>;
