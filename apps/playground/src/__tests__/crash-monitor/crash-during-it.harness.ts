import { describe, it } from 'react-native-harness';
import { Platform } from 'react-native';
import PlaygroundCrash from '../../native/PlaygroundCrash';

describe('Crash monitor: crash during test execution', () => {
  it('crashes the native app from inside an it clause', () => {
    PlaygroundCrash.crash(
      `HARNESS_CRASH_MONITOR_IT_CRASH platform=${Platform.OS}`
    );

    throw new Error('This line should not run after the native crash');
  });
});
