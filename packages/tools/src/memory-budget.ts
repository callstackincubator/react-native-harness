import * as os from 'node:os';

/**
 * Threshold (in bytes) at or below which a host is treated as memory-constrained.
 *
 * `os.totalmem()` reports usable RAM, not the marketing figure: a nominally
 * "8 GB" machine (e.g. a GitHub `macos-latest` runner) typically reports a
 * few hundred MB less than 8 * 1024^3 once firmware/GPU-reserved memory is
 * subtracted. The threshold is set above the exact 8 GiB boundary so that a
 * nominally 8 GB host is still classified as low-memory.
 */
export const LOW_MEMORY_HOST_THRESHOLD_BYTES = 8.5 * 1024 ** 3;

/**
 * Whether the current host is memory-constrained (~8 GB class or smaller).
 */
export const isLowMemoryHost = (): boolean => {
  return os.totalmem() <= LOW_MEMORY_HOST_THRESHOLD_BYTES;
};
