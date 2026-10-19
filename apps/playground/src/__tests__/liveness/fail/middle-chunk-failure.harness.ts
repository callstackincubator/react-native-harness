import { describe, test } from 'react-native-harness';
import { allMessages, expectMessageCount } from '../generated';

// Expected to FAIL with an assertion error whose code frame points at
// generated/assertion-helper.ts, a module in a middle chunk of the test
// bundle. A wrong frame means chunked evaluation broke symbolication.
describe('Failure in a middle chunk', () => {
  test('reports the code frame of the assertion helper', () => {
    expectMessageCount(allMessages, 1);
  });
});
