import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export type BundleClientProfile = 'expo' | 'bare';

/**
 * Metro only reuses a built dependency graph when the request's "graph key"
 * (entryFile, platform, dev, minify, lazy, transform.* / resolver.* params,
 * unstable_transformProfile) matches exactly. These param sets must mirror
 * what each client actually requests, or the pre-warmed graph is wasted work.
 */
export const getBundleSearchParams = (
  profile: BundleClientProfile,
  platform: string
): URLSearchParams => {
  if (profile === 'expo') {
    // Must stay byte-for-byte identical to the manifest launchAsset URL
    // built by getExpoMiddleware/getExpoManifest for Expo (managed/dev-client)
    // clients, or the pre-warmed graph won't match what the app requests.
    return new URLSearchParams([
      ['platform', platform],
      ['dev', 'true'],
      ['hot', 'false'],
      ['lazy', 'true'],
      ['transform.engine', 'hermes'],
      ['transform.bytecode', '1'],
      ['transform.routerRoot', 'app'],
      ['transform.reactCompiler', 'true'],
      ['unstable_transformProfile', 'hermes-stable'],
    ]);
  }

  // Bare RN dev clients (RCTBundleURLProvider / DevServerHelper) request
  // lazy=true in dev (lazy = enableDev), so the prewarm must match.
  return new URLSearchParams([
    ['platform', platform],
    ['dev', 'true'],
    ['minify', 'false'],
    ['lazy', 'true'],
  ]);
};

export const getBundleUrl = (options: {
  port: number;
  resolvedEntryPoint: string;
  platform: string;
  profile: BundleClientProfile;
}): string => {
  const { port, resolvedEntryPoint, platform, profile } = options;
  const searchParams = getBundleSearchParams(profile, platform);

  return `http://localhost:${port}/${resolvedEntryPoint}.bundle?${searchParams.toString()}`;
};

const EXPO_CONFIG_FILENAMES = [
  'app.config.js',
  'app.config.ts',
  'app.config.mjs',
  'app.config.cjs',
];

const hasExpoConfig = (projectRoot: string): boolean => {
  if (
    EXPO_CONFIG_FILENAMES.some((filename) =>
      fs.existsSync(path.join(projectRoot, filename))
    )
  ) {
    return true;
  }

  const appJsonPath = path.join(projectRoot, 'app.json');

  if (!fs.existsSync(appJsonPath)) {
    return false;
  }

  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    return Boolean(appJson && typeof appJson === 'object' && 'expo' in appJson);
  } catch {
    return false;
  }
};

const isExpoPackageResolvable = (projectRoot: string): boolean => {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('expo/package.json', { paths: [projectRoot] });
    return true;
  } catch {
    return false;
  }
};

/**
 * Detects whether a project should be treated as an Expo app for bundle
 * URL purposes. Both an Expo config file (or an `app.json` with a top-level
 * `expo` key) AND a resolvable `expo` package are required: a bare RN
 * `app.json` is just `{name, displayName}`, and bare apps that merely have
 * expo modules installed still lack the `expo` key -- so config presence
 * disambiguates better than package resolution alone. Never throws; any
 * read/parse failure is treated as 'bare'.
 */
export const detectBundleClientProfile = (
  projectRoot: string
): BundleClientProfile => {
  try {
    if (hasExpoConfig(projectRoot) && isExpoPackageResolvable(projectRoot)) {
      return 'expo';
    }
  } catch {
    return 'bare';
  }

  return 'bare';
};
