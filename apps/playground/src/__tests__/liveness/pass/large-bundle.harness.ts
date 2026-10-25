import { describe, test, expect } from 'react-native-harness';
import { allMessages, expectMessageCount } from '../generated';

// ~8 MB of generated modules: the test bundle is evaluated in chunks.
describe('Large test bundle', () => {
  test('loads every generated module', () => {
    expect(allMessages).toHaveLength(160 * 500);
    expectMessageCount(allMessages, 160 * 500);
  });
});
