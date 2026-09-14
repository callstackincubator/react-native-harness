import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../reader.js';

const CONFIG_BODY = {
  entryPoint: './index.js',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'test-runner',
      config: {},
      runner: 'test-runner',
      platformId: 'test-platform',
    },
  ],
};

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-reader-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('getConfig', () => {
  it('loads an ESM (.mjs) config via a file:// URL', async () => {
    // A bare absolute path passed to dynamic import() is rejected on Windows
    // (ERR_UNSUPPORTED_ESM_URL_SCHEME because `C:` reads as a URL scheme); the
    // reader must convert it with pathToFileURL first. This exercises that path
    // on every OS and regression-guards it on Windows.
    fs.writeFileSync(
      path.join(projectDir, 'rn-harness.config.mjs'),
      `export default ${JSON.stringify(CONFIG_BODY)};\n`
    );

    const { config, projectRoot } = await getConfig(projectDir);

    expect(config.entryPoint).toBe('./index.js');
    expect(config.runners).toHaveLength(1);
    expect(projectRoot).toBe(projectDir);
  });

  it('loads a CommonJS (.js) config', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rn-harness.config.js'),
      `module.exports = ${JSON.stringify(CONFIG_BODY)};\n`
    );

    const { config } = await getConfig(projectDir);

    expect(config.appRegistryComponentName).toBe('App');
  });

  it('loads a JSON config', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rn-harness.config.json'),
      JSON.stringify(CONFIG_BODY)
    );

    const { config } = await getConfig(projectDir);

    expect(config.entryPoint).toBe('./index.js');
  });

  it('walks up to a parent directory to find the config', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rn-harness.config.mjs'),
      `export default ${JSON.stringify(CONFIG_BODY)};\n`
    );
    const nested = path.join(projectDir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const { projectRoot } = await getConfig(nested);

    expect(projectRoot).toBe(projectDir);
  });
});
