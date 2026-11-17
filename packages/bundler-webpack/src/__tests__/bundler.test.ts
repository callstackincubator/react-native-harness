import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  BundlerEvent,
  BundlerFactoryOptions,
  BundlerInstance,
} from '@react-native-harness/bundlers';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import createBundler from '../bundler.js';
import { ManifestNotWatchedError, UnsupportedPlatformError } from '../errors.js';
import {
  rspackBundler,
  webpackBundler,
  WEBPACK_BUNDLER_NAME,
  RSPACK_BUNDLER_NAME,
} from '../index.js';
import type { WebpackBundlerConfig } from '../types.js';

// Resolves the compilers, the runtime and the babel preset like a project does.
const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const getFreePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

describe('descriptors', () => {
  it('describe webpack and Rspack with the same module', () => {
    const webpack = webpackBundler({ config: './webpack.config.js' });
    const rspack = rspackBundler({ config: './rspack.config.js' });

    expect(webpack).toEqual({
      name: WEBPACK_BUNDLER_NAME,
      displayName: 'webpack',
      module: expect.stringMatching(/bundler\.js$/),
      config: { compiler: 'webpack', config: './webpack.config.js' },
    });
    expect(rspack).toEqual({
      name: RSPACK_BUNDLER_NAME,
      displayName: 'Rspack',
      module: webpack.module,
      config: { compiler: 'rspack', config: './rspack.config.js' },
    });
  });

  it('names a module that exports the bundler factory', async () => {
    const { module } = webpackBundler({ config: './webpack.config.js' });
    const imported = (await import(module)) as { default: unknown };

    expect(imported.default).toBe(createBundler);
  });
});

const createOptions = (
  overrides: Partial<BundlerFactoryOptions<WebpackBundlerConfig, HarnessConfig>> & {
    platformId?: string;
  } = {}
): BundlerFactoryOptions<WebpackBundlerConfig, HarnessConfig> => {
  const { platformId = 'web', ...rest } = overrides;

  return {
    config: { compiler: 'webpack', config: './webpack.config.js' },
    projectRoot,
    harnessConfig: { metroPort: 8081 } as HarnessConfig,
    websocketEndpoints: {},
    platform: { platformId, name: platformId } as BundlerFactoryOptions<
      WebpackBundlerConfig,
      HarnessConfig
    >['platform'],
    watchMode: false,
    ...rest,
  };
};

describe('on a platform other than web', () => {
  it.each(['webpack', 'rspack'] as const)(
    'refuses to start %s with a clear error',
    async (compiler) => {
      const failure = await createBundler(
        createOptions({
          platformId: 'android',
          config: { compiler, config: './x.config.js' },
        }),
        new AbortController().signal
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(UnsupportedPlatformError);
      expect((failure as Error).message).toContain('web tests only');
      expect((failure as Error).message).toContain('"android"');
    }
  );
});

// The factory with a real compiler, a real server and a real WebSocket.
describe.each(['webpack', 'rspack'] as const)('the %s bundler', (compiler) => {
  let root: string;
  let dir: string;
  let bundler: BundlerInstance | undefined;

  beforeEach(() => {
    // Under node_modules, so the resolve-weak loader leaves the file alone: it
    // loads the Babel preset, which Vitest resolves to TypeScript source.
    root = fs.mkdtempSync(path.join(os.tmpdir(), `rn-harness-${compiler}-`));
    dir = path.join(root, 'node_modules', 'app');
    fs.mkdirSync(dir, { recursive: true });
    // The project's own copy of each compiler, as an install would give it.
    const modules = path.join(root, 'node_modules');
    fs.mkdirSync(path.join(modules, '@rspack'));
    fs.symlinkSync(
      path.dirname(require.resolve('webpack/package.json')),
      path.join(modules, 'webpack')
    );
    fs.symlinkSync(
      path.dirname(require.resolve('@rspack/core/package.json')),
      path.join(modules, '@rspack', 'core')
    );
    fs.writeFileSync(path.join(dir, 'app.js'), "console.log('app');");
    fs.writeFileSync(
      path.join(dir, 'warn-loader.cjs'),
      "module.exports = function (source) { this.emitWarning(new Error('loader warning for the log')); return source; };"
    );
    // Stands in for the runtime, which a build of its own needs React Native for.
    fs.writeFileSync(
      path.join(dir, 'runtime.js'),
      "exports.start = () => console.log('harness-started');"
    );
    fs.writeFileSync(
      path.join(dir, 'config.cjs'),
      `module.exports = {
        context: ${JSON.stringify(dir)},
        entry: './app.js',
        target: 'web',
        module: { rules: [{ test: /runtime\\.js$/, loader: ${JSON.stringify(path.join(dir, 'warn-loader.cjs'))} }] },
        resolve: { alias: { '@react-native-harness/runtime/webpack/entry-point$': ${JSON.stringify(path.join(dir, 'runtime.js'))} } },
        output: { path: ${JSON.stringify(path.join(dir, 'dist'))}, filename: '[name].js' },
        // The project lives under node_modules here, which watch mode skips.
        watchOptions: { ignored: '**/never' },
      };`
    );
    fs.writeFileSync(
      path.join(dir, 'config-ignored.cjs'),
      `const base = require('./config.cjs');
      module.exports = { ...base, watchOptions: { ignored: '**/.harness/**' } };`
    );
    fs.writeFileSync(
      path.join(dir, 'config-404.cjs'),
      `const base = require('./config.cjs');
      class Emit404 {
        apply(compiler) {
          const { RawSource } = compiler.webpack.sources;
          compiler.hooks.thisCompilation.tap('Emit404', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'Emit404', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
              () => compilation.emitAsset('404.html', new RawSource('<html>not found page</html>'))
            );
          });
        }
      }
      module.exports = { ...base, plugins: [new Emit404()] };`
    );
    // The same build, and a plugin that emits an HTML page as a real project's would.
    fs.writeFileSync(
      path.join(dir, 'config-html.cjs'),
      `const base = require('./config.cjs');
      class EmitHtml {
        apply(compiler) {
          const { RawSource } = compiler.webpack.sources;
          compiler.hooks.thisCompilation.tap('EmitHtml', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'EmitHtml', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
              () => compilation.emitAsset('index.html', new RawSource('<html>from the project</html>'))
            );
          });
        }
      }
      module.exports = { ...base, plugins: [new EmitHtml()] };`
    );
  });

  afterEach(async () => {
    await bundler?.dispose();
    bundler = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = async (
    websocketEndpoints = {},
    { watchMode = false, configFile = 'config.cjs' } = {}
  ) => {
    const port = await getFreePort();
    const instance = await createBundler(
      createOptions({
        projectRoot: dir,
        watchMode,
        config: { compiler, config: path.join(dir, configFile) },
        harnessConfig: {
          metroPort: port,
          entryPoint: path.join(dir, 'app.js'),
          appRegistryComponentName: 'App',
        } as HarnessConfig,
        websocketEndpoints,
      }),
      new AbortController().signal
    );
    bundler = instance;

    return { instance, port };
  };

  it('is healthy as soon as it listens, before it has files to build', async () => {
    const { instance, port } = await start();

    const health = await instance.waitUntilHealthy({
      timeoutMs: 1000,
      signal: new AbortController().signal,
    });

    expect(health.healthy).toBe(true);
    expect(health.status).toContain(String(port));
    expect(instance.getPrewarmState()).toBe('idle');
    expect(instance.isBuildInFlight()).toBe(false);
  });

  it('does not build until it has the files of the run, then prewarm resolves with the first build', async () => {
    const { instance, port } = await start();
    const events: BundlerEvent[] = [];
    instance.events.addListener((event) => events.push(event));

    const prewarm = instance.prewarm({
      platform: 'web',
      signal: new AbortController().signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(events).toEqual([]);
    expect(instance.getPrewarmState()).toBe('pending');
    expect((await fetch(`http://localhost:${port}/main.js`)).status).toBe(503);

    await instance.setRunFiles?.({ files: [] });

    await expect(prewarm).resolves.toBe(true);
    expect(instance.getPrewarmState()).toBe('succeeded');
    expect(events.map((event) => event.type)).toEqual([
      'build_started',
      'build_done',
    ]);
    expect(instance.isBuildInFlight()).toBe(false);
    const script = await (await fetch(`http://localhost:${port}/main.js`)).text();
    expect(script).toContain('harness-started');
    expect(script).not.toContain("console.log('app')");
  });

  it('writes the files of the run to the manifest, and compiles them once', async () => {
    fs.writeFileSync(path.join(dir, 'a.harness.js'), '');
    const { instance, port } = await start();

    try {
      await instance.setRunFiles?.({ files: ['a.harness.js'] });
      await instance.setRunFiles?.({ files: ['a.harness.js'] });
      await instance.prewarm({ platform: 'web', signal: new AbortController().signal });

      const manifest = fs.readFileSync(
        path.join(dir, '.harness', 'webpack', String(port), 'test-files.cjs'),
        'utf8'
      );
      expect(manifest).toContain('"a.harness.js"');
    } finally {
      fs.rmSync(path.join(dir, 'a.harness.js'));
    }
  });

  it('reports a request for the page as the app asking for its entry', async () => {
    const { instance, port } = await start();
    const events: BundlerEvent[] = [];
    instance.events.addListener((event) => events.push(event));
    await instance.setRunFiles?.({ files: [] });
    await instance.prewarm({ platform: 'web', signal: new AbortController().signal });

    const navigation = { 'Sec-Fetch-Dest': 'document' };
    await fetch(`http://localhost:${port}/somewhere/else.html`, { headers: navigation });
    await fetch(`http://localhost:${port}/`);
    await fetch(`http://localhost:${port}/main.js`, {
      headers: { 'Sec-Fetch-Dest': 'script' },
    });

    expect(events.filter((event) => event.type === 'entry_requested')).toEqual([
      { type: 'entry_requested', platform: 'web', requestKind: 'app' },
    ]);
  });

  const navigate = (port: number, path = '/') =>
    fetch(`http://localhost:${port}${path}`, { headers: { 'Sec-Fetch-Dest': 'document' } });

  it('serves a page with the root element and the entry script when the build emits no HTML', async () => {
    const { instance, port } = await start();
    await instance.setRunFiles?.({ files: [] });

    const response = await navigate(port, '/any/path');
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(page).toContain('<div id="root"></div>');
    expect(page).toContain('<script src="/main.js"></script>');
  });

  it('still serves the generated page when the build emits an unrelated .html file', async () => {
    const { instance, port } = await start({}, { configFile: 'config-404.cjs' });
    await instance.setRunFiles?.({ files: [] });

    const page = await (await navigate(port, '/any/path')).text();

    expect(page).toContain('<div id="root"></div>');
    expect(await (await navigate(port, '/404.html')).text()).toBe('<html>not found page</html>');
  });

  it('serves the page the project emits when the build has HTML', async () => {
    const { instance, port } = await start({}, { configFile: 'config-html.cjs' });
    await instance.setRunFiles?.({ files: [] });

    expect(await (await navigate(port, '/index.html')).text()).toBe('<html>from the project</html>');
    expect(await (await navigate(port, '/')).text()).toBe('<html>from the project</html>');
  });

  describe('in watch mode', () => {
    const loadPage = async (port: number) => {
      await (await navigate(port)).text();
      // `finish` runs after the body is sent.
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const prewarm = (instance: BundlerInstance) =>
      instance.prewarm({ platform: 'web', signal: new AbortController().signal });

    it('asks for no reload until the app loaded a page, then for one on every run', async () => {
      const { instance, port } = await start({}, { watchMode: true });

      // The first list starts the compiler; no page has been loaded.
      expect(await instance.setRunFiles?.({ files: [] })).toEqual({ reloadRequired: false });
      await prewarm(instance);
      expect(await instance.setRunFiles?.({ files: [] })).toEqual({ reloadRequired: false });

      await loadPage(port);
      // The manifest changes with every run, so there is always a newer build.
      fs.writeFileSync(path.join(dir, 'a.harness.js'), 'module.exports = 1;');
      expect(await instance.setRunFiles?.({ files: ['a.harness.js'] })).toEqual({ reloadRequired: true });
      expect(instance.isBuildInFlight()).toBe(false);

      await loadPage(port);
      expect(await instance.setRunFiles?.({ files: ['a.harness.js'] })).toEqual({ reloadRequired: true });
    }, 30000);

    it('has the edits made before the run in the build it waits for', async () => {
      const { instance, port } = await start({}, { watchMode: true });
      await instance.setRunFiles?.({ files: [] });
      await prewarm(instance);
      await loadPage(port);

      for (let edit = 1; edit <= 5; edit += 1) {
        fs.writeFileSync(
          path.join(dir, 'runtime.js'),
          `exports.start = () => console.log('harness-edit-${edit}');`
        );

        expect(await instance.setRunFiles?.({ files: [] })).toEqual({ reloadRequired: true });
        const script = await (await fetch(`http://localhost:${port}/main.js`)).text();
        expect(script).toContain(`harness-edit-${edit}`);
        await loadPage(port);
      }
    }, 60000);

    it('fails the run, saying why, when the compiler is told to ignore the manifest', async () => {
      const { instance, port } = await start(
        {},
        { watchMode: true, configFile: 'config-ignored.cjs' }
      );
      await instance.setRunFiles?.({ files: [] });
      await prewarm(instance);
      await loadPage(port);

      const failure = await instance.setRunFiles?.({ files: [] }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ManifestNotWatchedError);
      expect((failure as Error).message).toContain('test-files.cjs');
      expect((failure as Error).message).toContain('watchOptions.ignored');
    }, 60000);

    it('reports a build that fails, and recovers with the next one', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { instance, port } = await start({}, { watchMode: true });
      const events: string[] = [];
      instance.events.addListener((event) => events.push(event.type));
      await instance.setRunFiles?.({ files: [] });
      await prewarm(instance);
      await loadPage(port);

      try {
        fs.writeFileSync(path.join(dir, 'runtime.js'), 'exports.start = (;');
        expect(await instance.setRunFiles?.({ files: [] })).toEqual({ reloadRequired: true });
        expect(events).toContain('build_failed');

        fs.writeFileSync(path.join(dir, 'runtime.js'), "exports.start = () => console.log('harness-fixed');");
        events.length = 0;
        expect(await instance.setRunFiles?.({ files: [] })).toEqual({ reloadRequired: true });
        expect(events).not.toContain('build_failed');
        expect(events.at(-1)).toBe('build_done');
        expect(await (await fetch(`http://localhost:${port}/main.js`)).text()).toContain('harness-fixed');
      } finally {
        error.mockRestore();
      }
    }, 60000);
  });

  it('shows the warnings of the build in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { instance } = await start();

    try {
      await instance.setRunFiles?.({ files: [] });
      await instance.prewarm({ platform: 'web', signal: new AbortController().signal });

      expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
        'loader warning for the log'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('removes its generated files on dispose', async () => {
    const { instance, port } = await start();
    const generated = path.join(dir, '.harness', 'webpack', String(port));
    expect(fs.existsSync(generated)).toBe(true);

    await instance.dispose();

    expect(fs.existsSync(generated)).toBe(false);
  });

  it('answers /symbolicate with a stack and no code frame', async () => {
    const { port } = await start();

    const response = await fetch(`http://localhost:${port}/symbolicate`, {
      method: 'POST',
      body: JSON.stringify({ stack: [] }),
    });

    expect(await response.json()).toEqual({ stack: [], codeFrame: null });
  });

  it('mounts the bridge WebSocket on the same server, and closes it on dispose', async () => {
    const endpoint = new WebSocketServer({ noServer: true });
    const connected = new Promise<void>((resolve) => {
      endpoint.on('connection', () => resolve());
    });
    const { instance, port } = await start({ '/__harness': endpoint });
    const client = new WebSocket(`ws://localhost:${port}/__harness`);
    const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));

    await connected;
    await instance.dispose();

    await closed;
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it('refuses an upgrade for a path nobody mounted', async () => {
    const { port } = await start({ '/__harness': new WebSocketServer({ noServer: true }) });
    const client = new WebSocket(`ws://localhost:${port}/other`);

    await new Promise<void>((resolve) => client.on('error', () => resolve()));
  });

  it('stops a prewarm that is waiting when its signal aborts', async () => {
    const { instance } = await start();
    const controller = new AbortController();

    const prewarm = instance.prewarm({ platform: 'web', signal: controller.signal });
    controller.abort();

    await expect(prewarm).rejects.toBeDefined();
    expect(instance.getPrewarmState()).toBe('failed');
  });

  it('can be disposed twice', async () => {
    const { instance } = await start();

    await instance.dispose();
    await expect(instance.dispose()).resolves.toBeUndefined();
  });
});
