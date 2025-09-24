import { getDeviceDescriptor } from './client/getDeviceDescriptor.js';
import { getClient } from './client/index.js';

// Polyfill for EventTarget
const Shim = require('event-target-shim');
globalThis.Event = Shim.Event;
globalThis.EventTarget = Shim.EventTarget;

// Turn off LogBox
const { LogBox } = require('react-native');
LogBox.ignoreAllLogs(true);

// Turn off HMR
const HMRClient = require('react-native/Libraries/Utilities/HMRClient');

// Wait for HMRClient to be initialized
setTimeout(() => {
  HMRClient.disable();

  // Initialize the React Native Harness
  void getClient().then((client) =>
    client.rpc.reportReady(getDeviceDescriptor())
  );
});
