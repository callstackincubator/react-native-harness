import { describe, expect, it } from 'vitest';
import { diffGraphRelevantParams } from '../prewarm-guard.js';

describe('diffGraphRelevantParams', () => {
  it('reports no diff when params are identical but in a different order', () => {
    const prewarmUrl =
      '/index.bundle?platform=ios&dev=true&transform.engine=hermes';
    const appUrl =
      '/index.bundle?transform.engine=hermes&dev=true&platform=ios';

    expect(diffGraphRelevantParams(prewarmUrl, appUrl)).toEqual([]);
  });

  it('ignores serializer-only params (app, sourcePaths, runModule, hot)', () => {
    const prewarmUrl = '/index.bundle?platform=ios&dev=true';
    const appUrl =
      '/index.bundle?platform=ios&dev=true&app=com.example.app&sourcePaths=url-server&runModule=true&hot=false';

    expect(diffGraphRelevantParams(prewarmUrl, appUrl)).toEqual([]);
  });

  it('treats an omitted param as equal to its explicit Metro default', () => {
    const prewarmUrl = '/index.bundle?platform=ios';
    const appUrl = '/index.bundle?platform=ios&dev=true';

    expect(diffGraphRelevantParams(prewarmUrl, appUrl)).toEqual([]);
  });

  it('reports a diff naming the key when lazy differs', () => {
    const prewarmUrl = '/index.bundle?platform=ios&dev=true&lazy=true';
    const appUrl = '/index.bundle?platform=ios&dev=true&lazy=false';

    const diffs = diffGraphRelevantParams(prewarmUrl, appUrl);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('lazy');
  });

  it('reports a diff naming the key when transform.engine differs', () => {
    const prewarmUrl =
      '/index.bundle?platform=ios&dev=true&transform.engine=hermes';
    const appUrl = '/index.bundle?platform=ios&dev=true';

    const diffs = diffGraphRelevantParams(prewarmUrl, appUrl);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('transform.engine');
  });

  it('reports a diff naming pathname when entry files differ', () => {
    const prewarmUrl = '/index.bundle?platform=ios&dev=true';
    const appUrl = '/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true';

    const diffs = diffGraphRelevantParams(prewarmUrl, appUrl);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('pathname');
  });

  it('never throws on malformed URLs', () => {
    const malformed = 'http://[not-a-valid-host';
    expect(() => diffGraphRelevantParams(malformed, malformed)).not.toThrow();
    expect(diffGraphRelevantParams(malformed, malformed)).toEqual([]);
  });
});
