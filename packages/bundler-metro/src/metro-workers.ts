import { getDeviceCoreBudget } from '@react-native-harness/tools';

/**
 * Mirrors Metro's own `getMaxWorkers` default (metro-config's
 * `src/defaults/getMaxWorkers.js`), which is not reachable through
 * metro-config's `exports` map. Only used when the loaded Metro config has no
 * resolved `maxWorkers` -- `Metro.loadConfig` normally always supplies one.
 */
const getMetroDefaultMaxWorkers = (hostParallelism: number): number =>
  Math.max(
    1,
    Math.ceil(
      hostParallelism * (0.5 + 0.5 * Math.exp(-hostParallelism * 0.07)) - 1
    )
  );

/**
 * Resolves Metro's `maxWorkers` for a harness run. This only ever *lowers*
 * Metro's resolved value -- an explicit, lower `maxWorkers` is always
 * respected -- and applies two independent reductions:
 *
 * 1. Reserve the cores granted to the device under test, so Metro never
 *    competes with the emulator/simulator. On a 3-vCPU runner this alone
 *    lands on a single worker, which takes Metro's in-band transform path
 *    and spawns no child workers at all.
 * 2. Halve Metro's own default. Metro sizes its pool for bundling a whole
 *    app; a harness run transforms far fewer modules and reuses a persistent
 *    transform cache across runs, so the extra workers cost memory (each is
 *    a full Babel runtime) without shortening the build.
 */
export const getCappedMaxWorkers = ({
  configuredMaxWorkers,
  hostParallelism,
}: {
  configuredMaxWorkers: number | undefined;
  hostParallelism: number;
}): number => {
  const deviceCap = Math.max(
    1,
    hostParallelism - getDeviceCoreBudget(hostParallelism)
  );
  const metroResolved =
    configuredMaxWorkers ?? getMetroDefaultMaxWorkers(hostParallelism);
  const testBundleWorkers = Math.ceil(metroResolved / 2);

  return Math.max(1, Math.min(deviceCap, testBundleWorkers));
};
