import { describe, test, expect } from 'react-native-harness';

// Run with HARNESS_TEST_TIMEOUT=40000. Blocking the JS thread for 25s used
// to fail with `app heartbeat timed out` after about 20s; it is now allowed
// because it stays within the test's own timeout.
describe('Long synchronous work', () => {
  test('blocks the JS thread for 25 seconds within its timeout', () => {
    const end = Date.now() + 25_000;
    let spins = 0;
    while (Date.now() < end) {
      spins++;
    }
    expect(spins).toBeGreaterThan(0);
  });
});
