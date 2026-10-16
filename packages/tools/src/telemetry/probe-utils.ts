import type { LifecycleEvent, LifecyclePhase, ProbeContext } from './types.js';

/**
 * Runs `sample` on a fixed cadence (first sample immediately) and never lets
 * two samples overlap: if the previous one is still running when the timer
 * fires, that tick is skipped. This keeps sampling from piling up on a slow or
 * overloaded machine, which is exactly where it must stay cheap.
 *
 * The timer is unref'd so it can never keep the process alive. The returned
 * function stops sampling and aborts the signal handed to an in-flight sample.
 */
export const startSampler = (
  ctx: Pick<ProbeContext, 'signal' | 'track' | 'sampleIntervalMs'>,
  sample: (signal: AbortSignal) => void | Promise<void>
): (() => void) => {
  const controller = new AbortController();
  let running = false;

  const stop = () => {
    clearInterval(timer);
    controller.abort();
    ctx.signal.removeEventListener('abort', stop);
  };

  const tick = () => {
    if (running || controller.signal.aborted) {
      return;
    }
    running = true;
    const work = (async () => {
      try {
        await sample(controller.signal);
      } catch {
        // A failed sample is dropped; the next tick tries again.
      } finally {
        running = false;
      }
    })();
    void ctx.track(work);
  };

  const timer = setInterval(tick, ctx.sampleIntervalMs);
  timer.unref();
  ctx.signal.addEventListener('abort', stop, { once: true });
  tick();

  return stop;
};

/**
 * Subscribes to selected lifecycle phases. Handlers run as tracked work, so
 * the owner can wait for them, and a handler failure never propagates to the
 * code that emitted the phase.
 */
export const onLifecyclePhases = (
  ctx: Pick<ProbeContext, 'lifecycle' | 'track' | 'signal'>,
  phases: readonly LifecyclePhase[],
  handler: (event: LifecycleEvent) => void | Promise<void>
): (() => void) => {
  const listener = (event: LifecycleEvent) => {
    if (event.type !== 'phase' || !phases.includes(event.phase)) {
      return;
    }
    void ctx.track(
      (async () => {
        try {
          await handler(event);
        } catch {
          // Telemetry is best effort.
        }
      })()
    );
  };

  ctx.lifecycle.addListener(listener);
  return () => ctx.lifecycle.removeListener(listener);
};

/**
 * Runs queued jobs one after another. Lifecycle phases can fire back to back
 * (for example `app.ready` right before `dispose`); serialising keeps heavy
 * collectors from overlapping while still running every job.
 */
export const createSerialQueue = (): (<T>(
  job: () => Promise<T>
) => Promise<T | undefined>) => {
  let tail: Promise<unknown> = Promise.resolve();

  return (job) => {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result.catch(() => undefined);
  };
};
