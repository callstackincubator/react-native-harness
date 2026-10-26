import { getHostCapabilities, isCI } from '@react-native-harness/tools';

const MINIMUM_MEMORY_BYTES_FOR_PARALLEL_STARTUP = 8 * 1024 ** 3;
const MINIMUM_CPU_COUNT_FOR_PARALLEL_STARTUP = 6;
const MAXIMUM_CPU_COUNT_FOR_SERIAL_PREWARM = 3;

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

const isSmallHost = (): boolean => {
  const { totalMemoryBytes, availableCpuCount } = getHostCapabilities();

  return (
    availableCpuCount <= MAXIMUM_CPU_COUNT_FOR_SERIAL_PREWARM ||
    totalMemoryBytes < MINIMUM_MEMORY_BYTES_FOR_PARALLEL_STARTUP
  );
};

/**
 * Hosts with 3 cores or less than 8 GB (the standard GitHub macOS runner)
 * cannot boot a simulator and build the first bundle at the same time without
 * starving both, so the Metro prewarm waits until the simulator is up.
 */
export const shouldDeferMetroPrewarmUntilBooted = (): boolean => isSmallHost();

/**
 * On the same small hosts, the simulator's own background services leave too
 * little CPU and memory for the app under test, so on CI they are stopped
 * after boot. `slimOnCI` from the device config overrides the host check.
 */
export const shouldSlimSimulator = (slimOnCI?: boolean): boolean =>
  isCI() && (slimOnCI ?? isSmallHost());
