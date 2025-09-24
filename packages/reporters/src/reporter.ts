import { TestSuiteResult } from '@react-native-harness/bridge';

export type Reporter = {
  report: (results: TestSuiteResult[]) => Promise<void>;
};
