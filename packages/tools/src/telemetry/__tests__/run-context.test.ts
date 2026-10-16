import { describe, expect, it } from 'vitest';
import { collectRunContext, runContextProbe } from '../run-context.js';
import { createProbeContext } from './helpers.js';

describe('collectRunContext', () => {
  it('describes the machine', () => {
    const attrs = collectRunContext({});

    expect(attrs.cpuCount).toBeGreaterThan(0);
    expect(attrs.totalMemoryBytes).toBeGreaterThan(0);
    expect(attrs.platform).toBe(process.platform);
    expect(attrs.arch).toBe(process.arch);
    expect(attrs.nodeVersion).toBe(process.version);
    expect(attrs.ci).toBe(false);
    expect(attrs.harnessVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('includes GitHub runner details when present and nothing else from env', () => {
    const attrs = collectRunContext({
      CI: 'true',
      RUNNER_OS: 'macOS',
      RUNNER_ARCH: 'ARM64',
      ImageOS: 'macos15',
      ImageVersion: '20251001.1',
      GITHUB_RUN_ID: '42',
      GITHUB_JOB: 'e2e-ios',
      GITHUB_TOKEN: 'secret-token',
      NPM_TOKEN: 'secret-npm',
    });

    expect(attrs).toMatchObject({
      ci: true,
      RUNNER_OS: 'macOS',
      RUNNER_ARCH: 'ARM64',
      ImageOS: 'macos15',
      ImageVersion: '20251001.1',
      GITHUB_RUN_ID: '42',
      GITHUB_JOB: 'e2e-ios',
    });
    expect(JSON.stringify(attrs)).not.toContain('secret');
  });

  it('treats CI=false as not CI', () => {
    expect(collectRunContext({ CI: 'false' }).ci).toBe(false);
  });
});

describe('runContextProbe', () => {
  it('emits a single telemetry.context mark at start', () => {
    const ctx = createProbeContext();

    runContextProbe.start(ctx);

    const entries = ctx.diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: 'telemetry.context',
      kind: 'mark',
    });
    expect(entries[0]?.attrs?.cpuCount).toBeGreaterThan(0);
  });
});
