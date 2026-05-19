import type { HarnessTaskContext } from '@react-native-harness/bridge';
import type { ActiveTestContext } from './types.js';

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

export const createTestContext = (
  task: HarnessTaskContext,
): ActiveTestContext => {
  return {
    task,
    skip: createSkip(),
  };
};
