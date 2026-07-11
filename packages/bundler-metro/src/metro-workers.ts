/**
 * Number of host CPU cores left free for the device under test.
 *
 * The Android emulator is pinned to 2 vCPUs via `hw.cpu.ncore` in
 * `@react-native-harness/platform-android`, and the iOS simulator runs as
 * host processes alongside everything else. On 2-4 core GitHub-hosted CI
 * runners, Metro's transform workers (sized by Metro's own default formula,
 * which can claim every host core) would otherwise starve the device of
 * CPU right when both are busiest -- at startup.
 */
export const HOST_CORES_RESERVED_FOR_DEVICE = 2;

/**
 * Caps Metro's resolved `maxWorkers` so it never exceeds the host
 * parallelism minus the cores reserved for the device under test. This only
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
  const cap = Math.max(1, hostParallelism - HOST_CORES_RESERVED_FOR_DEVICE);

  return Math.min(configuredMaxWorkers ?? cap, cap);
};
