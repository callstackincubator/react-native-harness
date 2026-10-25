import { unrefTimer } from '../unref-timer.js';
import type { LifecycleEvent, LifecyclePhase, ProbeContext } from './types.js';

export type SampleInfo = {
  /** True for the first sample after sampling was paused between runs. */
  afterPause: boolean;
};

/**
 * Runs `sample` on a fixed cadence (first sample immediately) and never lets
 * two samples overlap: if the previous one is still running when the timer
 * fires, that tick is skipped. This keeps sampling from piling up on a slow or
 * overloaded machine, which is exactly where it must stay cheap.
 *
 * Sampling pauses on `run.end` and resumes (with an immediate sample) on the
 * next `run.start` or on `dispose`. A single run therefore samples
 * continuously from session start to teardown, while a watch-mode session
 * that sits idle between runs does not accumulate samples nobody asked for.
 *
 * The timer is unref'd so it can never keep the process alive. The returned
 * function stops sampling and aborts the signal handed to an in-flight sample.
 */
export const startSampler = (
  ctx: Pick<
    ProbeContext,
    'signal' | 'track' | 'sampleIntervalMs' | 'lifecycle'
  >,
  sample: (signal: AbortSignal, info: SampleInfo) => void | Promise<void>
): (() => void) => {
  const controller = new AbortController();
  let running = false;
  let paused = false;
  let afterPause = false;

  const tick = () => {
    if (running || paused || controller.signal.aborted) {
      return;
    }
    running = true;
    const info = { afterPause };
    afterPause = false;
    const work = (async () => {
      try {
        await sample(controller.signal, info);
      } catch {
        // A failed sample is dropped; the next tick tries again.
      } finally {
        running = false;
      }
    })();
    void ctx.track(work);
  };

  const onPhase = (event: LifecycleEvent) => {
    if (event.phase === 'run.end') {
      paused = true;
    } else if (
      paused &&
      (event.phase === 'run.start' || event.phase === 'dispose')
    ) {
      paused = false;
      afterPause = true;
      tick();
    }
  };

  const stop = () => {
    clearInterval(timer);
    controller.abort();
    ctx.lifecycle.removeListener(onPhase);
    ctx.signal.removeEventListener('abort', stop);
  };

  const timer = setInterval(tick, ctx.sampleIntervalMs);
  unrefTimer(timer);
  ctx.signal.addEventListener('abort', stop, { once: true });
  ctx.lifecycle.addListener(onPhase);
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

export type SerialQueue = {
  /** Queues `job`; resolves undefined if it failed or the queue was closed. */
  run<T>(job: () => Promise<T>): Promise<T | undefined>;
  /** Jobs still waiting are skipped from now on; a running job is not interrupted. */
  close(): void;
};

/**
 * Runs queued jobs one after another. Lifecycle phases can fire back to back
 * (for example `app.ready` right before `dispose`); serialising keeps heavy
 * collectors from overlapping while still running every job. Closing the
 * queue (when the probe stops) turns the remaining jobs into no-ops, so
 * nothing runs, or reports, after teardown began.
 */
export const createSerialQueue = (): SerialQueue => {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  return {
    run: (job) => {
      const guarded = async () => (closed ? undefined : job());
      const result = tail.then(guarded, guarded);
      tail = result.catch(() => undefined);
      return result.catch(() => undefined);
    },
    close: () => {
      closed = true;
    },
  };
};
