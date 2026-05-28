import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('iOS crashes', () => {
  it('objc sync', () => {
    console.log('before objc sync');
    PlaygroundCrash.crashFromObjectiveCSync('crash/ios/objc-sync.harness.ts objc sync');
    alert('after objc sync');
  });
});
