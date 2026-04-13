import type { Config as HarnessConfig } from '@react-native-harness/config';
import { isPortAvailable } from '@react-native-harness/bundler-metro';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import { MetroPortRangeExhaustedError } from './errors.js';
import type { ResourceLease, ResourceLockManager } from './resource-lock.js';

export const METRO_PORT_SCAN_ATTEMPTS = 10;

const getPortLockKey = (host: string | undefined, port: number): string => {
  return `metro-port:${host?.trim() || '*'}:${port}`;
};

const isIosPhysicalRunner = (platform: HarnessPlatform): boolean => {
  return platform.platformId === 'ios' && platform.name.includes('device');
};

export const resolveHarnessMetroPort = async (options: {
  config: HarnessConfig;
  platform: HarnessPlatform;
  resourceLockManager: ResourceLockManager;
  signal: AbortSignal;
}): Promise<{
  config: HarnessConfig;
  metroPortLease: ResourceLease | null;
  initialMetroPort: number;
  didFallback: boolean;
}> => {
  const { config, platform, resourceLockManager, signal } = options;
  const initialMetroPort = config.metroPort;
  const host = config.host?.trim();

  if (isIosPhysicalRunner(platform)) {
    return {
      config,
      metroPortLease: null,
      initialMetroPort,
      didFallback: false,
    };
  }

  for (let attempt = 0; attempt < METRO_PORT_SCAN_ATTEMPTS; attempt += 1) {
    const candidatePort = initialMetroPort + attempt;
    const metroPortLease = await resourceLockManager.acquire(
      getPortLockKey(host, candidatePort),
      { signal }
    );

    try {
      if (!(await isPortAvailable(candidatePort, host))) {
        await metroPortLease.release();
        continue;
      }

      return {
        config:
          candidatePort === initialMetroPort
            ? config
            : {
                ...config,
                metroPort: candidatePort,
              },
        metroPortLease,
        initialMetroPort,
        didFallback: candidatePort !== initialMetroPort,
      };
    } catch (error) {
      await metroPortLease.release();
      throw error;
    }
  }

  throw new MetroPortRangeExhaustedError(
    initialMetroPort,
    METRO_PORT_SCAN_ATTEMPTS
  );
};
