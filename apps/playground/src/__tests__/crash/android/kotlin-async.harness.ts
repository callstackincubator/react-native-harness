import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('Android crashes', () => {
  it('kotlin async', () => {
    console.log('before kotlin async');
    PlaygroundCrash.crashFromKotlinAsync('crash/android/kotlin-async.harness.ts kotlin async');
    alert('after kotlin async');
  });
});
