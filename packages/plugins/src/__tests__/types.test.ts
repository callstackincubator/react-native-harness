import { describe, expect, it } from 'vitest';
import { HARNESS_HOOKS } from '../types.js';

describe('plugin hook definitions', () => {
  it('registers the structured app monitor hooks', () => {
    expect(HARNESS_HOOKS).toEqual(
      expect.arrayContaining([
        { flatName: 'app:started', path: ['app', 'started'] },
        { flatName: 'app:exited', path: ['app', 'exited'] },
        { flatName: 'app:crash-suspected', path: ['app', 'crashSuspected'] },
        { flatName: 'app:crash-confirmed', path: ['app', 'crashConfirmed'] },
        { flatName: 'app:crash-report-ready', path: ['app', 'crashReportReady'] },
        { flatName: 'app:monitor-warning', path: ['app', 'monitorWarning'] },
      ]),
    );
  });
});
