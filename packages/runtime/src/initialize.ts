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
HMRClient.setup = () => {
  // No setup = no HMR
};

// Initialize the client
void getClient().then((client) =>
  client.rpc.reportReady(getDeviceDescriptor())
);
