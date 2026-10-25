import { describe, test } from 'react-native-harness';

// Expected to FAIL about testTimeout + 5s after the test starts, with
// "The app's JS thread was blocked for longer than allowed ... It was busy
// with: test "Hang spins forever" (10000ms timeout + 5000ms grace)."
describe('Hang', () => {
  test('spins forever', () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // never yields
    }
  });
});
