import { describe, test } from 'react-native-harness';

// Run with HARNESS_TEST_TIMEOUT=90000. Expected to FAIL with "The app
// stopped answering WebSocket pings" about 20-25s after the app process is
// frozen with `kill -STOP <pid>` while this test waits. Without freezing the
// app, it passes after 60 seconds.
describe('Connection lost', () => {
  test('waits while the app process is frozen', async () => {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  });
});
