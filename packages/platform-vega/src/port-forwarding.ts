import { logger } from '@react-native-harness/tools';
import { VegaMetroPortError } from './errors.js';
import type * as vegaModule from './vega.js';

type VegaCli = typeof vegaModule;

const log = logger.child('platform-vega');

// Debug builds of React Native for Vega load the bundle from localhost:8081
// on the device, and the Vega CLI only forwards that port.
export const VEGA_DEVICE_METRO_PORT = 8081;

export type VegaMetroAccess = {
  dispose: () => Promise<void>;
};

/**
 * Makes the harness Metro server reachable from the device on port 8081.
 */
export const configureVegaMetroAccess = async (
  vega: VegaCli,
  { deviceId, isVirtual }: { deviceId: string; isVirtual: boolean },
  metroPort: number
): Promise<VegaMetroAccess> => {
  if (metroPort === VEGA_DEVICE_METRO_PORT) {
    let disposing = false;
    const forwarding = vega.startPortForwarding(deviceId, metroPort);

    void forwarding.subprocess.then(
      () => log.debug('port forwarding for %s ended', deviceId),
      (error) => {
        if (!disposing) {
          log.warn('port forwarding for %s failed: %s', deviceId, error);
        }
      }
    );

    return {
      dispose: async () => {
        disposing = true;
        await forwarding.dispose();
        await vega.stopPortForwarding(deviceId, metroPort);
      },
    };
  }

  if (!(await vega.getVdaBinaryPath())) {
    throw new VegaMetroPortError(metroPort);
  }

  log.info(
    'Mapping device port %d to Metro port %d with vda',
    VEGA_DEVICE_METRO_PORT,
    metroPort
  );
  const serial = await vega.resolveVdaSerial(deviceId, isVirtual);
  await vega.vdaReverse(serial, VEGA_DEVICE_METRO_PORT, metroPort);

  return {
    dispose: async () => {
      await vega.vdaRemoveReverse(serial, VEGA_DEVICE_METRO_PORT);
    },
  };
};
