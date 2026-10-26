import { createRequire } from 'node:module';
import os from 'node:os';
import type { DiagnosticAttrs } from '../diagnostics.js';
import type { TelemetryProbe } from './types.js';
import { isCI } from './host-health.js';

const GITHUB_RUNNER_ENV = [
  'RUNNER_OS',
  'RUNNER_ARCH',
  'ImageOS',
  'ImageVersion',
  'GITHUB_RUN_ID',
  'GITHUB_JOB',
] as const;

const getHarnessVersion = (): string | undefined => {
  try {
    // All Harness packages are released in lockstep, so the version of this
    // package is the version of the Harness in use.
    const require = createRequire(import.meta.url);
    return (require('../../package.json') as { version?: string }).version;
  } catch {
    return undefined;
  }
};

/**
 * Describes the machine and CI environment. Only an allowlist of
 * non-sensitive variables is read; nothing else from `env` is recorded.
 */
export const collectRunContext = (
  env: NodeJS.ProcessEnv = process.env
): DiagnosticAttrs => {
  const attrs: DiagnosticAttrs = {
    cpuCount: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    ci: isCI(env),
    harnessVersion: getHarnessVersion(),
  };

  for (const key of GITHUB_RUNNER_ENV) {
    const value = env[key];
    if (value) {
      attrs[key] = value;
    }
  }

  return attrs;
};

/** Emits a single `telemetry.context` mark describing the host. */
export const runContextProbe: TelemetryProbe = {
  name: 'run-context',
  start: ({ diagnostics }) => {
    diagnostics.mark('telemetry.context', collectRunContext());
    return () => undefined;
  },
};
