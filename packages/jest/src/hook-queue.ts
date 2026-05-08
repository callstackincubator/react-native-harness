export type HookQueue = {
  schedule: (work: () => Promise<void>) => void;
  drain: () => Promise<void>;
};

export const createHookQueue = (): HookQueue => {
  let tail: Promise<void> = Promise.resolve();
  let firstError: unknown;

  const schedule = (work: () => Promise<void>): void => {
    tail = tail.then(work).catch((err) => {
      firstError ??= err;
    });
  };

  const drain = async (): Promise<void> => {
    await tail;
    if (firstError !== undefined) {
      const err = firstError;
      firstError = undefined;
      throw err;
    }
  };

  return { schedule, drain };
};
