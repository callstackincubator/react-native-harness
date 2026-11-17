import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundlerInstance } from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import createBundler from '../bundler.js';
import type { WebpackBundlerConfig } from '../types.js';

const require = createRequire(import.meta.url);

const getFreePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const NAMINGS = {
  default: '',
  'a map file in another folder': "sourceMapFilename: 'maps/[file].map',",
  'file: URLs for sources':
    "devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]',",
  'paths relative to the context': "devtoolModuleFilenameTemplate: '[resource-path]',",
  'webpack:/// and an absolute path':
    "devtoolModuleFilenameTemplate: 'webpack:///[absolute-resource-path]',",
};

type Frame = {
  methodName: string;
  file: string;
  lineNumber: number;
  column: number;
};
type Symbolicated = {
  stack: Array<{ file: string; lineNumber: number; column: number; collapse?: boolean }>;
  codeFrame: { fileName: string; location: { row: number; column: number }; content: string } | null;
};

/** The position of `needle` in a script, as a browser's stack would give it. */
const positionOf = (script: string, needle: string): { lineNumber: number; column: number } => {
  const index = script.indexOf(needle);
  const before = script.slice(0, index);

  return {
    lineNumber: before.split('\n').length,
    column: index - (before.lastIndexOf('\n') + 1),
  };
};

describe.each(['webpack', 'rspack'] as const)('/symbolicate with %s', (compiler) => {
  let root: string;
  let project: string;
  let bundler: BundlerInstance | undefined;

  beforeEach(() => {
    // Under node_modules, so that the resolve-weak loader leaves the files
    // alone: it loads the Babel preset, which Vitest resolves to TypeScript
    // source. Frames there are collapsed, which does not change what is mapped.
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `rn-harness-sym-${compiler}-`));
    project = path.join(root, 'node_modules', 'app');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    const modules = path.join(project, 'node_modules');
    fs.mkdirSync(path.join(modules, '@rspack'), { recursive: true });
    fs.symlinkSync(
      path.dirname(require.resolve('webpack/package.json')),
      path.join(modules, 'webpack')
    );
    fs.symlinkSync(
      path.dirname(require.resolve('@rspack/core/package.json')),
      path.join(modules, '@rspack', 'core')
    );
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"sym-app"}');
    fs.writeFileSync(path.join(project, 'src', 'app.js'), "console.log('app');");
    fs.writeFileSync(
      path.join(project, 'src', 'throws-main.js'),
      "module.exports = function boomMain() {\n  throw new Error('boom-main');\n};\n"
    );
    fs.writeFileSync(
      path.join(project, 'src', 'webpack-named.js'),
      "module.exports = function boomFolder() {\n  throw new Error('boom-folder');\n};\n"
    );
    fs.mkdirSync(path.join(project, 'src', 'webpack'));
    fs.writeFileSync(
      path.join(project, 'src', 'webpack', 'inside.js'),
      "module.exports = function boomInside() {\n  throw new Error('boom-inside');\n};\n"
    );
    fs.writeFileSync(
      path.join(project, 'src', 'throws-async.js'),
      "exports.boomAsync = function boomAsync() {\n  throw new Error('boom-async');\n};\n"
    );
    fs.writeFileSync(
      path.join(project, 'src', 'runtime.js'),
      `exports.start = () => {
        globalThis.boomMain = require('./throws-main.js');
        globalThis.boomInside = require('./webpack/inside.js');
        import(/* webpackChunkName: "async" */ './throws-async.js');
      };`
    );
  });

  afterEach(async () => {
    await bundler?.dispose();
    bundler = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = async (naming: string) => {
    fs.writeFileSync(
      path.join(project, 'config.cjs'),
      `module.exports = {
        context: ${JSON.stringify(project)},
        entry: './src/app.js',
        target: 'web',
        resolve: { alias: { '@react-native-harness/runtime/webpack/entry-point$': ${JSON.stringify(path.join(project, 'src', 'runtime.js'))} } },
        output: { path: ${JSON.stringify(path.join(project, 'dist'))}, filename: '[name].js', chunkFilename: 'chunks/[name].js', ${naming} },
      };`
    );
    const port = await getFreePort();
    bundler = await createBundler(
      {
        config: { compiler, config: path.join(project, 'config.cjs') } as WebpackBundlerConfig,
        projectRoot: project,
        harnessConfig: {
          metroPort: port,
          entryPoint: path.join(project, 'src', 'app.js'),
          appRegistryComponentName: 'App',
        } as HarnessConfig,
        websocketEndpoints: {},
        platform: { platformId: 'web', name: 'web' } as never,
        watchMode: false,
      },
      new AbortController().signal
    );
    await bundler.setRunFiles?.({ files: [] });
    await bundler.prewarm({ platform: 'web', signal: new AbortController().signal });

    return port;
  };

  const symbolicate = async (port: number, frames: Frame[]): Promise<Symbolicated> => {
    const response = await fetch(`http://localhost:${port}/symbolicate`, {
      method: 'POST',
      body: JSON.stringify({ stack: frames }),
    });

    return (await response.json()) as Symbolicated;
  };

  describe.each(Object.entries(NAMINGS))('with %s', (_, naming) => {
    it('maps a throw in the main chunk to its original line, and builds a code frame', async () => {
      const port = await start(naming);
      const script = await (await fetch(`http://localhost:${port}/main.js`)).text();
      const position = positionOf(script, "throw new Error('boom-main')");

      const result = await symbolicate(port, [
        { methodName: 'boomMain', file: `http://localhost:${port}/main.js`, ...position },
      ]);

      expect(result.stack[0]).toMatchObject({
        file: path.join(project, 'src', 'throws-main.js'),
        lineNumber: 2,
      });
      expect(result.codeFrame).toMatchObject({
        fileName: path.join(project, 'src', 'throws-main.js'),
        location: { row: 2 },
      });
      expect(result.codeFrame?.content).toContain('boom-main');
    });

    it('maps a throw in an async chunk', async () => {
      const port = await start(naming);
      const script = await (await fetch(`http://localhost:${port}/chunks/async.js`)).text();
      const position = positionOf(script, "throw new Error('boom-async')");

      const result = await symbolicate(port, [
        { methodName: 'boomAsync', file: `http://localhost:${port}/chunks/async.js`, ...position },
      ]);

      expect(result.codeFrame).toMatchObject({
        fileName: path.join(project, 'src', 'throws-async.js'),
        location: { row: 2 },
      });
    });
  });

  it('does not take a project folder called webpack for the bundler runtime', async () => {
    const port = await start('');
    const script = await (await fetch(`http://localhost:${port}/main.js`)).text();
    const position = positionOf(script, "throw new Error('boom-inside')");

    const result = await symbolicate(port, [
      { methodName: 'boomInside', file: `http://localhost:${port}/main.js`, ...position },
    ]);

    expect(result.stack[0].file).toBe(path.join(project, 'src', 'webpack', 'inside.js'));
  });

  it('collapses the bundler runtime, and leaves a script with no map as it is', async () => {
    const port = await start('');
    const script = await (await fetch(`http://localhost:${port}/main.js`)).text();
    const runtime = positionOf(script, '__webpack_require__.o =');
    const frames: Frame[] = [
      { methodName: 'require', file: `http://localhost:${port}/main.js`, ...runtime },
      { methodName: 'other', file: `http://localhost:${port}/other.js`, lineNumber: 3, column: 4 },
    ];

    const result = await symbolicate(port, frames);

    expect(result.stack[0].collapse).toBe(true);
    expect(result.stack[1]).toEqual(frames[1]);
    // Neither frame names a file.
    expect(result.codeFrame).toBeNull();
  });
});
