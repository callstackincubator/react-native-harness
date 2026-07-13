import { getDeviceCoreBudget } from '@react-native-harness/tools';

/**
 * Caps Metro's resolved `maxWorkers` so it never exceeds the host
 * parallelism minus the cores granted to the device under test. This only
 * ever lowers the resolved value -- it never raises it -- so a user's
 * explicit, lower `maxWorkers` and Metro's own default on many-core
 * machines are both respected.
 */
export const getCappedMaxWorkers = ({
  configuredMaxWorkers,
  hostParallelism,
}: {
  configuredMaxWorkers: number | undefined;
  hostParallelism: number;
}): number => {
  const cap = Math.max(
    1,
    hostParallelism - getDeviceCoreBudget(hostParallelism)
  );

  return Math.min(configuredMaxWorkers ?? cap, cap);
};
