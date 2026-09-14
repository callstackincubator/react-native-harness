import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAgentDeviceVersion } from '../plan-ios-runner-cache.js';

let projectRoot: string;

describe('resolveAgentDeviceVersion', () => {
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ci-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reads the version from a hoisted node_modules layout', () => {
    const packageDir = path.join(projectRoot, 'node_modules', 'agent-device');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'agent-device', version: '0.21.0' })
    );

    expect(resolveAgentDeviceVersion(projectRoot)).toBe('0.21.0');
  });

  it('returns null when agent-device is not installed', () => {
    expect(resolveAgentDeviceVersion(projectRoot)).toBeNull();
  });
});
