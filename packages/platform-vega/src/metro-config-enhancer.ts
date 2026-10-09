import { createRequire } from 'node:module';
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

const enhanceMetroConfig: MetroConfigEnhancer = (
  metroConfig: MetroConfig,
  { projectRoot }: MetroConfigEnhancerContext
): MetroConfig => {
  const initializeCore = resolveInitializeCore(projectRoot);
  const existingRunBeforeMainModule =
    metroConfig.serializer?.getModulesRunBeforeMainModule;

  return {
    ...metroConfig,
    resolver: {
      ...metroConfig.resolver,
      platforms: [
        ...new Set([
          ...(metroConfig.resolver?.platforms ?? ['ios', 'android']),
          KEPLER_PLATFORM,
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
};

export default enhanceMetroConfig;
