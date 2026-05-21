import { describe, it } from 'react-native-harness';
import { Platform } from 'react-native';
import PlaygroundCrash from '../../native/PlaygroundCrash';

PlaygroundCrash.crash(
  `HARNESS_CRASH_MONITOR_EVALUATION_CRASH platform=${Platform.OS}`
);

describe('Crash monitor: crash during test file evaluation', () => {
  it('should never run because the test file crashes before registration', () => {
    throw new Error('This test should not run after an evaluation crash');
  });
});
