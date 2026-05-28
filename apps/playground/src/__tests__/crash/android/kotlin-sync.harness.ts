import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('Android crashes', () => {
  it('kotlin sync', () => {
    console.log('before kotlin sync');
    PlaygroundCrash.crashFromKotlinSync('crash/android/kotlin-sync.harness.ts kotlin sync');
    alert('after kotlin sync');
  });
});
