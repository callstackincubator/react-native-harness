import type { Status } from '@jest/test-result';
import type { TestResultStatus } from '@react-native-harness/bridge';

// Jest's own runners expose skipped assertions as `pending` to reporters.
export const toJestStatus = (status: TestResultStatus): Status =>
  status === 'skipped' ? 'pending' : status;
