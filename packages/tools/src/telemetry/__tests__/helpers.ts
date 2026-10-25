import { vi } from 'vitest';
import { createDiagnostics } from '../../diagnostics.js';
import { getEmitter } from '../../events.js';
import type { LifecycleEvent, ProbeContext } from '../types.js';

export const createProbeContext = (
  overrides: Partial<ProbeContext> = {}
): ProbeContext & {
  controller: AbortController;
  pending: Set<Promise<unknown>>;
} => {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();

  return {
    diagnostics: createDiagnostics({ enabled: true }),
    signal: controller.signal,
    lifecycle: getEmitter<LifecycleEvent>(),
    sampleIntervalMs: 5000,
    track: (work) => {
      pending.add(work);
      return work;
    },
    controller,
    pending,
    ...overrides,
  };
};

/** Waits for all work registered through `ctx.track`. */
export const settle = async (ctx: { pending: Set<Promise<unknown>> }) => {
  await Promise.allSettled([...ctx.pending]);
};

export const setPlatform = (platform: NodeJS.Platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
};
