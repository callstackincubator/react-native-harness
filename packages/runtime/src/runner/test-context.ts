import type { HarnessTaskContext } from '@react-native-harness/bridge';
import type { ActiveTestContext } from './types.js';

export type TestLifecycleState = {
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

export const createTestLifecycleState = (): TestLifecycleState => {
  return {
    onTestFinished: [],
  };
};

export const runOnTestFinished = async (
  state: TestLifecycleState,
): Promise<void> => {
  for (let i = state.onTestFinished.length - 1; i >= 0; i--) {
    await state.onTestFinished[i]();
  }
};

export const createTestContext = (
  task: HarnessTaskContext,
  state: TestLifecycleState,
): ActiveTestContext => {
  return {
    task,
    onTestFinished: createOnTestFinished(state),
    skip: createSkip(),
  };
};
