import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('iOS crashes', () => {
  it('swift async', () => {
    console.log('before swift async');
    PlaygroundCrash.crashFromSwiftAsync('crash/ios/swift-async.harness.ts swift async');
    alert('after swift async');
  });
});
