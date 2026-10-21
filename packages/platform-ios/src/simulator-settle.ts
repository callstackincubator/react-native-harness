export type SimulatorSettleResult = {
  settled: boolean;
  durationMs: number;
  probes: number;
};

export type SimulatorSettleOptions = {
  /** Runs one responsiveness probe; rejection counts as "not fast". */
  probe: (signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fastProbeThresholdMs?: number;
  requiredConsecutiveFastProbes?: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Waits (bounded) until the simulator guest answers probes quickly. Never
 * throws: on timeout, abort, or probe failure it simply returns.
 */
export const waitForSimulatorToSettle = async ({
  probe,
  signal,
  now = Date.now,
  sleep = defaultSleep,
  fastProbeThresholdMs = 300,
  requiredConsecutiveFastProbes = 2,
  maxWaitMs = 45_000,
  pollIntervalMs = 500,
}: SimulatorSettleOptions): Promise<SimulatorSettleResult> => {
  const startedAt = now();
  let probes = 0;
  let streak = 0;
  const result = (settled: boolean): SimulatorSettleResult => ({
    settled,
    durationMs: now() - startedAt,
    probes,
  });

  while (!signal?.aborted && now() - startedAt < maxWaitMs) {
    const probeStartedAt = now();
    probes++;
    try {
      await probe(signal);
      streak =
        now() - probeStartedAt < fastProbeThresholdMs ? streak + 1 : 0;
    } catch {
      streak = 0;
    }

    if (streak >= requiredConsecutiveFastProbes) return result(true);
    const remainingMs = maxWaitMs - (now() - startedAt);
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollIntervalMs, remainingMs), signal);
  }

  return result(false);
};
