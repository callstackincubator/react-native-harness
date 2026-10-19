import { describe, test, expect, beforeAll } from 'react-native-harness';

// Run with HARNESS_TEST_TIMEOUT=40000. A beforeAll may block the JS thread
// for as long as the hook timeout allows, like a test.
describe('Long synchronous beforeAll', () => {
  let spins = 0;

  beforeAll(() => {
    const end = Date.now() + 25_000;
    while (Date.now() < end) {
      spins++;
    }
  });

  test('runs after a beforeAll that blocked for 25 seconds', () => {
    expect(spins).toBeGreaterThan(0);
  });
});
