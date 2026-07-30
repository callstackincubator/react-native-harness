import { getHostCapabilities } from '@react-native-harness/tools';

const MINIMUM_MEMORY_BYTES_FOR_PARALLEL_STARTUP = 8 * 1024 ** 3;
const MINIMUM_CPU_COUNT_FOR_PARALLEL_STARTUP = 6;

export const shouldOverlapXCTestBuildAndSimulatorBoot = (): boolean => {
  const { totalMemoryBytes, availableCpuCount } = getHostCapabilities();

  return (
    totalMemoryBytes > MINIMUM_MEMORY_BYTES_FOR_PARALLEL_STARTUP &&
    availableCpuCount > MINIMUM_CPU_COUNT_FOR_PARALLEL_STARTUP
  );
};
