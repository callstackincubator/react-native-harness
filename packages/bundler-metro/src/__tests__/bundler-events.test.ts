import { describe, expect, it } from 'vitest';
import { toBundlerEvent } from '../bundler-events.js';

describe('toBundlerEvent', () => {
  it('translates bundle_build_started with its details', () => {
    expect(
      toBundlerEvent({
        type: 'bundle_build_started',
        buildID: 'build-1',
        bundleDetails: {
          bundleType: 'bundle',
          dev: true,
          entryFile: 'index.js',
          minify: false,
          platform: 'ios',
        },
      })
    ).toEqual({
      type: 'build_started',
      buildId: 'build-1',
      platform: 'ios',
      entryFile: 'index.js',
      dev: true,
    });
  });

  it('translates bundle_build_done and bundle_build_failed', () => {
    expect(toBundlerEvent({ type: 'bundle_build_done', buildID: 'b' })).toEqual({
      type: 'build_done',
      buildId: 'b',
    });
    expect(
      toBundlerEvent({ type: 'bundle_build_failed', buildID: 'b' })
    ).toEqual({ type: 'build_failed', buildId: 'b' });
  });

  it('translates bundle_request_observed into entry_requested', () => {
    expect(
      toBundlerEvent({
        type: 'bundle_request_observed',
        platform: 'android',
        requestKind: 'prewarm',
        timestamp: '2026-01-01T00:00:00.000Z',
        url: '/index.bundle?platform=android',
      })
    ).toEqual({
      type: 'entry_requested',
      platform: 'android',
      requestKind: 'prewarm',
    });
  });

  it('passes client_log through', () => {
    expect(
      toBundlerEvent({ type: 'client_log', level: 'warn', data: ['a', 1] })
    ).toEqual({ type: 'client_log', level: 'warn', data: ['a', 1] });
  });

  it('drops events Harness does not consume', () => {
    expect(toBundlerEvent({ type: 'initialize_done' })).toBeNull();
    expect(toBundlerEvent({ type: 'transformer_load_started' })).toBeNull();
  });
});
