import { describe, expect, it } from 'vitest';
import { StartupStallError } from '../errors.js';

// These strings are what Metro users see. They are copied from the messages
// `bundler-metro` produced before the bundler interface was extracted.
describe('StartupStallError messages for Metro', () => {
  it('metro_not_ready', () => {
    const error = new StartupStallError(1000, 1, {
      bundlerName: 'Metro',
      code: 'metro_not_ready',
      lastMetroStatus: 'HTTP 503: packager-status:starting',
      prewarmState: 'idle',
    });

    expect(error.message).toBe(
      'Metro did not report a healthy /status response within 1000ms. Last status: HTTP 503: packager-status:starting.'
    );
  });

  it('ready_not_reported, for one and several attempts', () => {
    const one = new StartupStallError(2000, 1, {
      bundlerName: 'Metro',
      code: 'ready_not_reported',
      lastMetroStatus: 'HTTP 200: packager-status:running',
    });
    const three = new StartupStallError(2000, 3, {
      bundlerName: 'Metro',
      code: 'ready_not_reported',
      lastMetroStatus: 'HTTP 200: packager-status:running',
    });

    expect(one.message).toBe(
      'The app requested its Metro bundle but Harness did not become ready within 2000ms after 1 launch attempt. Last Metro status: HTTP 200: packager-status:running.'
    );
    expect(three.message).toBe(
      'The app requested its Metro bundle but Harness did not become ready within 2000ms after 3 launch attempts. Last Metro status: HTTP 200: packager-status:running.'
    );
  });

  it.each([
    ['succeeded', ' Only prewarm traffic was observed.'],
    ['pending', ' The prewarm bundle was still building.'],
    ['failed', ' The prewarm bundle failed to build.'],
    ['idle', ''],
  ] as const)(
    'bundle_request_not_observed with prewarm %s',
    (prewarmState, suffix) => {
      const error = new StartupStallError(1500, 3, {
        bundlerName: 'Metro',
        code: 'bundle_request_not_observed',
        lastMetroStatus: 'HTTP 200: packager-status:running',
        prewarmState,
      });

      expect(error.message).toBe(
        `The app did not request its Metro bundle after 3 launch attempts within 1500ms. Last Metro status: HTTP 200: packager-status:running.${suffix}`
      );
    }
  );

  it('uses singular "attempt" and "unknown" status when none is given', () => {
    const error = new StartupStallError(1500, 1, { bundlerName: 'Metro' });

    expect(error.message).toBe(
      'The app did not request its Metro bundle after 1 launch attempt within 1500ms. Last Metro status: unknown.'
    );
  });
});
