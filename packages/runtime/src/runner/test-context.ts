import type { HarnessTaskContext } from '@react-native-harness/bridge';
import type { ActiveTestContext } from './types.js';
import type { TestHostSession } from '../host-surface.js';

export type TestLifecycleState = {
  onTestFailed: Array<() => void | Promise<void>>;
  onTestFinished: Array<() => void | Promise<void>>;
};

export class SkipTestError extends Error {
  note?: string;

  constructor(note?: string) {
    super(note ?? 'Test skipped');
    this.name = 'SkipTestError';
    this.note = note;
  }
}

export const isSkipTestError = (error: unknown): error is SkipTestError => {
  return error instanceof SkipTestError;
};

const createSkip = () => {
  function skip(noteOrCondition?: boolean | string, note?: string): void {
    if (typeof noteOrCondition === 'boolean') {
      if (!noteOrCondition) {
        return;
      }

      throw new SkipTestError(note);
    }

    throw new SkipTestError(noteOrCondition);
  }

  return skip as ActiveTestContext['skip'];
};

const createOnTestFinished = (state: TestLifecycleState) => {
  return (fn: () => void | Promise<void>): void => {
    state.onTestFinished.push(fn);
  };
};

const createOnTestFailed = (state: TestLifecycleState) => {
  return (fn: () => void | Promise<void>): void => {
    state.onTestFailed.push(fn);
  };
};

export const createTestLifecycleState = (): TestLifecycleState => {
  return {
    onTestFailed: [],
    onTestFinished: [],
  };
};

export const runOnTestFailed = async (
  state: TestLifecycleState,
  hostSession?: TestHostSession,
): Promise<void> => {
  for (let i = state.onTestFailed.length - 1; i >= 0; i--) {
    const callback = state.onTestFailed[i];
    if (hostSession) {
      await hostSession.run(async () => {
        await callback();
      });
    } else {
      await callback();
    }
  }
};

export const runOnTestFinished = async (
  state: TestLifecycleState,
  hostSession?: TestHostSession,
): Promise<void> => {
  for (let i = state.onTestFinished.length - 1; i >= 0; i--) {
    const callback = state.onTestFinished[i];
    if (hostSession) {
      await hostSession.run(async () => {
        await callback();
      });
    } else {
      await callback();
    }
  }
};

export const createTestContext = (
  task: HarnessTaskContext,
  state: TestLifecycleState,
): ActiveTestContext => {
  return {
    task,
    onTestFailed: createOnTestFailed(state),
    onTestFinished: createOnTestFinished(state),
    skip: createSkip(),
  };
};
