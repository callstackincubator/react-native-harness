import { getEmitter } from '@react-native-harness/tools';
import type {
  BundlerEvent,
  BundlerInstance,
  HarnessBundlerFactory,
} from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { getMetroInstance } from './factory.js';
import { toBundlerEvent } from './bundler-events.js';
import type { ReportableEvent } from './reporter.js';
import type { MetroWebSocketEndpoints } from './types.js';
import type { MetroBundlerConfig } from './metro-bundler.js';

const createMetroBundler: HarnessBundlerFactory<
  MetroBundlerConfig,
  HarnessConfig
> = async (options, signal): Promise<BundlerInstance> => {
  const {
    projectRoot,
    harnessConfig,
    websocketEndpoints,
    platform,
    watchMode,
  } = options;
  const metro = await getMetroInstance(
    {
      projectRoot,
      harnessConfig,
      metroConfigEnhancer: platform.metroConfigEnhancer,
      platformId: platform.platformId,
      platformConfig: platform.config,
      // Metro types the endpoint's `handleUpgrade` as generic over the client,
      // which no concrete WebSocket server can satisfy.
      websocketEndpoints: websocketEndpoints as MetroWebSocketEndpoints,
      watchMode,
    },
    signal
  );

  const events = getEmitter<BundlerEvent>();
  const onMetroEvent = (event: ReportableEvent) => {
    const bundlerEvent = toBundlerEvent(event);
    if (bundlerEvent) {
      events.emit(bundlerEvent);
    }
  };
  metro.events.addListener(onMetroEvent);

  return {
    events,
    waitUntilHealthy: metro.waitUntilHealthy,
    prewarm: metro.prewarm,
    getPrewarmState: metro.getPrewarmState,
    isBuildInFlight: metro.isBuildInFlight,
    dispose: () => {
      metro.events.removeListener(onMetroEvent);
      return metro.dispose();
    },
  };
};

export default createMetroBundler;
