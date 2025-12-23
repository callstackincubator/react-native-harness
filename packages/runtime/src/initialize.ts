import { getDeviceDescriptor } from './client/getDeviceDescriptor.js';
import { getClient } from './client/index.js';
import { disableHMRWhenReady } from './disableHMRWhenReady.js';
import { setupJestMock } from './jest-mock.js';

// Polyfill for EventTarget
const Shim = require('event-target-shim');
globalThis.Event = Shim.Event;
globalThis.EventTarget = Shim.EventTarget;

// Setup jest mock to warn users about using Jest APIs
setupJestMock();

// Turn off LogBox
const { LogBox } = require('react-native');
LogBox.ignoreAllLogs(true);

// Turn off HMR
const HMRClientModule = require('react-native/Libraries/Utilities/HMRClient');
const HMRClient =
  'default' in HMRClientModule ? HMRClientModule.default : HMRClientModule;

// Wait for HMRClient to be initialized
setTimeout(() => {
  void disableHMRWhenReady(() => HMRClient.disable(), 50).then(() =>
    getClient().then((client) =>
      client.rpc.reportReady(getDeviceDescriptor())
    )
  );
});

// Re-throw fatal errors
ErrorUtils.setGlobalHandler((error) => {
  throw error;
});
