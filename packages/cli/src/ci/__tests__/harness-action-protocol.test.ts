import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The 'react-native-harness' package.json declares `harnessActionProtocol`
// as a capability marker: the callstackincubator/react-native-harness
// GitHub Action reads it (see action.yml's "Verify react-native-harness
// supports this action's CLI interface" step) to confirm the installed CLI
// supports `harness ci <subcommand>` before invoking it, instead of
// comparing version numbers -- a version floor can't be satisfied by the
// very release that introduces the capability it requires. This test exists
// so the marker isn't silently dropped in a future refactor of that
// package.json, which would make the action's guard reject every install.
describe('react-native-harness package.json harnessActionProtocol marker', () => {
  it('declares a numeric harnessActionProtocol capability marker', async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '../../../../..');
    const packageJsonPath = path.join(
      workspaceRoot,
      'packages/react-native-harness/package.json'
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

    expect(typeof packageJson.harnessActionProtocol).toBe('number');
    expect(packageJson.harnessActionProtocol).toBeGreaterThanOrEqual(1);
  });
});
