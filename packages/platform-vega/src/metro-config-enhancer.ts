import { createRequire } from 'node:module';
import path from 'node:path';
import { logger } from '@react-native-harness/tools';
import type {
  MetroConfigEnhancer,
  MetroConfigEnhancerContext,
} from '@react-native-harness/bundler-metro';
import type { MetroConfig } from 'metro-config';
import type { CustomResolutionContext, Resolution } from 'metro-resolver';

const require = createRequire(import.meta.url);
const log = logger.child('platform-vega');

// Metro platform name used by React Native for Vega.
export const KEPLER_PLATFORM = 'kepler';
const KEPLER_PACKAGE = '@amazon-devices/react-native-kepler';
const SYSTEM_BUNDLE_UTILS =
  '@amazon-devices/kepler-cli-platform/dist/common/systemBundleUtils';

type SystemBundleUtils = {
  applySystemBundleConfig: (
    projectRoot: string,
    buildType: 'Debug' | 'Release',
    entryFile: string,
    baseConfig: MetroConfig
  ) => { config: MetroConfig; applied: boolean };
};

type MetroResolveRequest = (
  context: CustomResolutionContext,
  moduleName: string,
  platform: string | null
) => Resolution;

/**
 * Redirects `react-native` / `react-native/*` imports to Amazon's React
 * Native fork when Metro is bundling for the `kepler` platform.
 *
 * `react-native start` installs this via the platform's `npmPackageName` in
 * `@amazon-devices/kepler-cli-platform`. The harness loads Metro's config
 * directly and never runs that plugin, so the platform package supplies the
 * redirect itself.
 */
const withKeplerPackageRedirect = (
  next: MetroResolveRequest | undefined
): MetroResolveRequest => {
  const passThrough: MetroResolveRequest =
    next ?? ((ctx, name, plat) => ctx.resolveRequest(ctx, name, plat));

  return (context, moduleName, platform) => {
    if (platform !== KEPLER_PLATFORM) {
      return passThrough(context, moduleName, platform);
    }

    let redirected = moduleName;
    if (moduleName === 'react-native') {
      redirected = KEPLER_PACKAGE;
    } else if (moduleName.startsWith('react-native/')) {
      redirected = `${KEPLER_PACKAGE}/${moduleName.slice('react-native/'.length)}`;
    }

    return passThrough(context, redirected, platform);
  };
};

/**
 * Resolves the Kepler fork's `InitializeCore` from the project. The default
 * React Native Metro config lists upstream `react-native`'s InitializeCore as
 * a run-before-main module, but the redirect keeps that file out of a `kepler`
 * bundle, so Metro drops it and the runtime is never set up: the app never
 * renders and Vega OS kills it as unresponsive. Metro only emits a `require()`
 * for a run-before module that ends up in the graph, so this is inert for any
 * non-Vega bundle.
 */
const resolveInitializeCore = (projectRoot: string): string | null => {
  const specifier = `${KEPLER_PACKAGE}/Libraries/Core/InitializeCore`;
  try {
    return require.resolve(specifier, { paths: [projectRoot] });
  } catch {
    log.warn(
      'could not resolve %s from %s; Vega bundles may fail to initialize',
      specifier,
      projectRoot
    );
    return null;
  }
};

/**
 * Vega apps use "system bundles" by default: React Native and the other
 * libraries that ship with the OS stay out of the app bundle, and the app
 * bundle maps its requires onto the OS copy. `react-native start` sets this
 * up through `@amazon-devices/kepler-cli-platform`, which Harness never runs,
 * so the same helper is applied here. Apps that opt out with
 * `kepler.useSystemJsBundles: false` get a regular bundle.
 */
const usesSystemBundles = (projectRoot: string): boolean => {
  try {
    const pkg = require(path.join(projectRoot, 'package.json')) as {
      kepler?: { useSystemJsBundles?: boolean };
    };
    return pkg.kepler?.useSystemJsBundles !== false;
  } catch {
    return true;
  }
};

const withSystemBundles = (
  metroConfig: MetroConfig,
  projectRoot: string,
  buildType: 'Debug' | 'Release'
): MetroConfig => {
  if (!usesSystemBundles(projectRoot)) {
    log.debug('system bundles are disabled for %s', projectRoot);
    return metroConfig;
  }

  let utils: SystemBundleUtils;
  try {
    utils = require(
      require.resolve(SYSTEM_BUNDLE_UTILS, { paths: [projectRoot] })
    ) as SystemBundleUtils;
  } catch {
    log.warn(
      'could not load %s from %s; React Native will be bundled into the app bundle instead of coming from the Vega system bundles',
      SYSTEM_BUNDLE_UTILS,
      projectRoot
    );
    return metroConfig;
  }

  const { config, applied } = utils.applySystemBundleConfig(
    projectRoot,
    buildType,
    'index.js',
    metroConfig
  );

  if (!applied) {
    log.warn(
      'Vega system bundle config was not applied; build the %s package first so its system bundle artifacts exist',
      buildType
    );
  }

  return config;
};

const enhanceMetroConfig: MetroConfigEnhancer = (
  metroConfig: MetroConfig,
  { projectRoot, platformConfig }: MetroConfigEnhancerContext
): MetroConfig => {
  const initializeCore = resolveInitializeCore(projectRoot);
  const existingRunBeforeMainModule =
    metroConfig.serializer?.getModulesRunBeforeMainModule;
  const buildType =
    (platformConfig as { buildType?: 'Debug' | 'Release' } | undefined)
      ?.buildType ?? 'Debug';

  const enhanced: MetroConfig = {
    ...metroConfig,
    resolver: {
      ...metroConfig.resolver,
      platforms: [
        ...new Set([
          ...(metroConfig.resolver?.platforms ?? [
            KEPLER_PLATFORM,
            'ios',
            'android',
          ]),
          'native',
        ]),
      ],
      resolveRequest: withKeplerPackageRedirect(
        metroConfig.resolver?.resolveRequest ?? undefined
      ),
    },
    serializer: {
      ...metroConfig.serializer,
      ...(initializeCore
        ? {
            getModulesRunBeforeMainModule: (entryPoint: string) => [
              ...(existingRunBeforeMainModule?.(entryPoint) ?? []),
              initializeCore,
            ],
          }
        : {}),
    },
  };

  return withSystemBundles(enhanced, projectRoot, buildType);
};

export default enhanceMetroConfig;
