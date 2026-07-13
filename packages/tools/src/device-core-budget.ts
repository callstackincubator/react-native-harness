/**
 * Smallest viable vCPU allocation for a guest device (2 cores).
 */
export const MIN_DEVICE_CORE_BUDGET = 2;

/**
 * The emulator's useful vCPU ceiling (4 cores); allocating more does not
 * improve it.
 */
export const MAX_DEVICE_CORE_BUDGET = 4;

/**
 * Derives the vCPU budget for a guest device from host parallelism.
 */
export const getDeviceCoreBudget = (hostParallelism: number): number => {
  return Math.min(
    Math.max(Math.floor(hostParallelism / 2), MIN_DEVICE_CORE_BUDGET),
    MAX_DEVICE_CORE_BUDGET
  );
};
