import { Platform } from 'react-native';
import { describe, it } from 'react-native-harness';

import PlaygroundCrash from '../native/PlaygroundCrash';

if (Platform.OS === 'ios') {
  describe('iOS crashes', () => {
    it('objc sync', () => {
      console.log('before objc sync');
      PlaygroundCrash.crashFromObjectiveCSync(
        'crash-test.harness.ts objc sync',
      );
      alert('after objc sync');
    });

    it('objc async', () => {
      console.log('before objc async');
      PlaygroundCrash.crashFromObjectiveCAsync(
        'crash-test.harness.ts objc async',
      );
      alert('after objc async');
    });

    it('swift sync', () => {
      console.log('before swift sync');
      PlaygroundCrash.crashFromSwiftSync('crash-test.harness.ts swift sync');
      alert('after swift sync');
    });

    it('swift async', () => {
      console.log('before swift async');
      PlaygroundCrash.crashFromSwiftAsync(
        'crash-test.harness.ts swift async',
      );
      alert('after swift async');
    });
  });
}

if (Platform.OS === 'android') {
  describe('Android crashes', () => {
    it('kotlin sync', () => {
      console.log('before kotlin sync');
      PlaygroundCrash.crashFromKotlinSync('crash-test.harness.ts kotlin sync');
      alert('after kotlin sync');
    });

    it('kotlin async', () => {
      console.log('before kotlin async');
      PlaygroundCrash.crashFromKotlinAsync(
        'crash-test.harness.ts kotlin async',
      );
      alert('after kotlin async');
    });
  });
}
