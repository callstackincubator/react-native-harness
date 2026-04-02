import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('Android GitHub action config', () => {
  it('does not duplicate Android SDK verification in the action YAML', async () => {
    const [rootAction, packageAction] = await Promise.all([
      readFile(path.join(workspaceRoot, 'action.yml'), 'utf8'),
      readFile(
        path.join(workspaceRoot, 'packages/github-action/src/action.yml'),
        'utf8'
      ),
    ]);

    for (const actionYaml of [rootAction, packageAction]) {
      expect(actionYaml).not.toContain('Verify Android SDK packages');
      expect(actionYaml).toContain(
        "steps.avd-cache.outputs.cache-hit != 'true'"
      );
    }
  });

  it('removes the third-party emulator runner and maps cacheAvd to HARNESS_AVD_CACHING', async () => {
    const [rootAction, packageAction] = await Promise.all([
      readFile(path.join(workspaceRoot, 'action.yml'), 'utf8'),
      readFile(
        path.join(workspaceRoot, 'packages/github-action/src/action.yml'),
        'utf8'
      ),
    ]);

    for (const actionYaml of [rootAction, packageAction]) {
      expect(actionYaml).not.toContain(
        'reactivecircus/android-emulator-runner'
      );
      expect(actionYaml).toContain(
        'HARNESS_AVD_CACHING: ${{ inputs.cacheAvd }}'
      );
      expect(actionYaml).toContain(
        'fromJson(steps.load-config.outputs.config).action.avdCachingEnabled'
      );
    }
  });

  it('saves the AVD cache after the Harness run step', async () => {
    const [rootAction, packageAction] = await Promise.all([
      readFile(path.join(workspaceRoot, 'action.yml'), 'utf8'),
      readFile(
        path.join(workspaceRoot, 'packages/github-action/src/action.yml'),
        'utf8'
      ),
    ]);

    for (const actionYaml of [rootAction, packageAction]) {
      expect(actionYaml.indexOf('- name: Run E2E tests')).toBeLessThan(
        actionYaml.indexOf('- name: Save AVD cache')
      );
    }
  });

  it('uses a cache key that includes the emulator name', async () => {
    const [rootAction, packageAction] = await Promise.all([
      readFile(path.join(workspaceRoot, 'action.yml'), 'utf8'),
      readFile(
        path.join(workspaceRoot, 'packages/github-action/src/action.yml'),
        'utf8'
      ),
    ]);

    for (const actionYaml of [rootAction, packageAction]) {
      expect(actionYaml).toContain(
        "AVD_NAME='${{ fromJson(steps.load-config.outputs.config).config.device.name }}'"
      );
      expect(actionYaml).toContain(
        'CACHE_KEY="avd-$AVD_NAME-$ARCH-$AVD_CONFIG_HASH"'
      );
    }
  });
});
