import { describe, expect, it } from 'vitest';
import { getFs, runWithHarnessContext } from '../harness-context.js';
import { createInMemoryFileSystem } from '../testing.js';

describe('createInMemoryFileSystem', () => {
  it('keeps files isolated from the host filesystem', () => {
    const fs = createInMemoryFileSystem();

    runWithHarnessContext({ fs }, () => {
      getFs().mkdirSync('/project');
      getFs().writeFileSync('/project/config.json', '{"enabled":true}');

      expect(getFs().readFileSync('/project/config.json', 'utf8')).toBe(
        '{"enabled":true}'
      );
    });
  });
});
