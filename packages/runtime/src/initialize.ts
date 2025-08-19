import { EnvironmentError } from './errors.js';

if (!global.RN_HARNESS) {
  throw new EnvironmentError(
    'runtime initialization',
    'You are not in a test environment.'
  );
}

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
