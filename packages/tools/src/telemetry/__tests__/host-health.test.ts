import { describe, expect, it } from 'vitest';
import {
  evaluateHostHealth,
  formatGitHubWarning,
  formatSaturatedHostMessage,
  isCI,
  isHostStarved,
} from '../host-health.js';

describe('isCI', () => {
  it.each([
    [{ CI: 'true' }, true],
    [{ CI: '1' }, true],
    [{ CI: 'false' }, false],
    [{ CI: '0' }, false],
    [{}, false],
  ])('treats %o as CI=%s', (env, expected) => {
    expect(isCI(env)).toBe(expected);
  });
});

describe('evaluateHostHealth', () => {
  it.each([
    [{ load1: 7, cpuCount: 3, idlePct: 40 }, true],
    [{ load1: 2, cpuCount: 3, idlePct: 3 }, true],
    [{ load1: 6, cpuCount: 3, idlePct: 30 }, false],
    [{ load1: 1, cpuCount: 3, idlePct: null }, false],
  ])('judges %o as saturated=%s', (sample, saturated) => {
    expect(evaluateHostHealth(sample).saturated).toBe(saturated);
  });
});

describe('formatSaturatedHostMessage', () => {
  it('names the load, idle share and the busiest processes', () => {
    expect(
      formatSaturatedHostMessage(
        { load1: 9.24, cpuCount: 3, idlePct: 2.4, saturated: true },
        [
          {
            pid: 412,
            cpu_pct: 85.5,
            rss_mb: 500,
            command: '/System/Library/Support/mds_stores',
          },
          { pid: 7, cpu_pct: 40, rss_mb: 50, command: 'softwareupdated' },
        ]
      )
    ).toBe(
      'The CI runner was already saturated before Harness started anything (load 9.2 on 3 cores, 2% idle). Startup timeouts on this run are likely caused by the host, not the app. Busiest processes: mds_stores (86% CPU), softwareupdated (40% CPU).'
    );
  });
});

describe('formatGitHubWarning', () => {
  it('escapes the title and message for a workflow command', () => {
    expect(
      formatGitHubWarning('Host: busy, slow', '100% busy\nline two', {
        GITHUB_ACTIONS: 'true',
      })
    ).toBe('::warning title=Host%3A busy%2C slow::100%25 busy%0Aline two');
  });

  it('returns null outside GitHub Actions', () => {
    expect(formatGitHubWarning('title', 'message', {})).toBeNull();
  });
});

describe('isHostStarved', () => {
  it.each([
    [{ peakLoad1: 7, minHostFreeMb: 900, swapoutsDeltaMb: 0 }, true],
    [{ peakLoad1: 2, minHostFreeMb: 900, swapoutsDeltaMb: 300 }, true],
    [{ peakLoad1: 5, minHostFreeMb: 30, swapoutsDeltaMb: 10 }, false],
    [{ peakLoad1: null, minHostFreeMb: null, swapoutsDeltaMb: null }, false],
  ])('judges %o on 3 cores as starved=%s', (pressure, starved) => {
    expect(isHostStarved({ ...pressure, cpuCount: 3 })).toBe(starved);
  });
});
