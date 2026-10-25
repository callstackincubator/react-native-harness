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

/**
 * Small hosts keep running first-boot work (SpringBoard, daemons) after
 * `bootstatus` returns, so they benefit from an extra settle step.
 */
export const shouldWaitForSimulatorToSettle = (): boolean =>
  !shouldOverlapXCTestBuildAndSimulatorBoot();

const CONSTRAINED_HOST_XCTEST_AGENT_TICK_INTERVAL_MS = 2000;

/**
 * Every agent tick costs accessibility queries against the simulator. On
 * constrained hosts those compete with the app under test, so the agent ticks
 * less often there. Other hosts keep the agent's own default.
 */
export const getDefaultXCTestAgentTickIntervalMs = (): number | undefined =>
  shouldWaitForSimulatorToSettle()
    ? CONSTRAINED_HOST_XCTEST_AGENT_TICK_INTERVAL_MS
    : undefined;
