import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('iOS crashes', () => {
  it('objc async', () => {
    console.log('before objc async');
    PlaygroundCrash.crashFromObjectiveCAsync('crash/ios/objc-async.harness.ts objc async');
    alert('after objc async');
  });
});
