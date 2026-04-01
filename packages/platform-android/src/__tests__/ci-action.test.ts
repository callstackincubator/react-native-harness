import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('Android GitHub action config', () => {
  it('keeps SDK verification enabled even when the AVD cache hits', async () => {
    const [rootAction, packageAction] = await Promise.all([
      readFile(path.join(workspaceRoot, 'action.yml'), 'utf8'),
      readFile(
        path.join(workspaceRoot, 'packages/github-action/src/action.yml'),
        'utf8'
      ),
    ]);

    for (const actionYaml of [rootAction, packageAction]) {
      expect(actionYaml).toContain('Verify Android SDK packages');
      expect(actionYaml).toContain(
        "steps.avd-cache.outputs.cache-hit != 'true'"
      );
    }
  });
});
