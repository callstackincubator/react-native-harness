import { getDeviceDescriptor } from './client/getDeviceDescriptor.js';
import { getClient } from './client/index.js';
import { getHost } from './host.js';
import { setupJestMock } from './jest-mock.js';

// Polyfill for EventTarget on runtimes that don't ship one (RN's JSC).
// Do NOT overwrite when a native ctor already exists (RN Web / browsers):
// Safari's EventTarget.dispatchEvent() does an internal brand check and
// rejects polyfill instances with a TypeError, which breaks any
// DOM-event-driven flow in the page — most visibly DRM (FairPlay) via
// libraries that re-dispatch synthetic `encrypted` events.
const Shim = require('event-target-shim');
if (typeof globalThis.Event !== 'function') {
  globalThis.Event = Shim.Event;
}
if (typeof globalThis.EventTarget !== 'function') {
  globalThis.EventTarget = Shim.EventTarget;
}

// Setup jest mock to warn users about using Jest APIs
setupJestMock();

const host = getHost();

// Turn off LogBox and HMR, and re-throw fatal errors
host.prepare();

// Wait for HMRClient to be initialized
setTimeout(() => {
  void (async () => {
    try {
      await host.disableHMR();
      const handle = await getClient();

      const deviceDescriptor = getDeviceDescriptor();
      handle.reportReady(deviceDescriptor);
    } catch (error) {
      console.error('Failed to initialize React Native Harness', error);
    }
  })();
});

