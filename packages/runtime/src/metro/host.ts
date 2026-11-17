import { Platform } from 'react-native';
import parseErrorStack from 'react-native/Libraries/Core/Devtools/parseErrorStack';
import type { Host } from '../host.js';
import { getDevServerUrl } from './dev-server.js';
import { disableHMRWhenReady } from './disableHMRWhenReady.js';

let HMRClient: { disable: () => void } | undefined;

const loadHMRClient = (): { disable: () => void } => {
  if (!HMRClient) {
    const HMRClientModule = require('react-native/Libraries/Utilities/HMRClient');
    HMRClient =
      'default' in HMRClientModule ? HMRClientModule.default : HMRClientModule;
  }

  return HMRClient as { disable: () => void };
};

export const metroHost: Host = {
  getDevServerUrl,
  reloadRuntime: () => {
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      // Required lazily: react-native-web doesn't export DevSettings, so a
      // named import would be undefined on web. Only native reaches this.
      const { DevSettings } = require('react-native');
      DevSettings.reload();
    }
  },
  parseErrorStack,
  prepare: () => {
    // Turn off LogBox
    const { LogBox } = require('react-native');
    LogBox.ignoreAllLogs(true);

    // Turn off HMR
    loadHMRClient();

    // Re-throw fatal errors
    ErrorUtils.setGlobalHandler((error) => {
      throw error;
    });
  },
  // Wait for HMRClient to be initialized
  disableHMR: () => disableHMRWhenReady(() => loadHMRClient().disable(), 50),
};
