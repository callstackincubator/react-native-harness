import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../../../native/PlaygroundCrash';

describe('iOS crashes', () => {
  it('swift sync', () => {
    console.log('before swift sync');
    PlaygroundCrash.crashFromSwiftSync('crash/ios/swift-sync.harness.ts swift sync');
    alert('after swift sync');
  });
});
