import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { formatPath } from '../path.js';

describe('formatPath', () => {
  it('formats absolute paths relative to the current working directory', () => {
    expect(
      formatPath(
        path.join('/project', '.harness', 'crash-reports', 'log.txt'),
        {
          cwd: '/project',
        }
      )
    ).toBe(path.join('.harness', 'crash-reports', 'log.txt'));
  });

  it('leaves relative paths unchanged', () => {
    expect(formatPath(path.join('.harness', 'crash-reports', 'log.txt'))).toBe(
      path.join('.harness', 'crash-reports', 'log.txt')
    );
  });

  it('formats the working directory as a dot', () => {
    expect(formatPath('/project', { cwd: '/project' })).toBe('.');
  });
});
