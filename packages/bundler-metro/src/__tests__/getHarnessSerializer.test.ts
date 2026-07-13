import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  getHarnessSerializer as getHarnessSerializerImpl,
  type GetHarnessSerializerOptions,
  type Serializer,
} from '../getHarnessSerializer.js';

const require = createRequire(import.meta.url);
const baseJSBundle: (...args: unknown[]) => {
  pre: string;
  post: string;
  modules: Array<[number, string]>;
} = require('metro/private/DeltaBundler/Serializers/baseJSBundle').default;
const bundleToString: (bundle: unknown) => { code: string } = require(
  'metro/private/lib/bundleToString'
).default;

type FakeModule = {
  path: string;
  dependencies: Map<string, unknown>;
  inverseDependencies: Set<string>;
  getSource: () => Buffer;
  output: ReadonlyArray<{
    type: string;
    data: {
      code: string;
      lineCount: number;
      map: unknown[];
      functionMap: null;
    };
  }>;
};

const countLines = (code: string): number =>
  (code.match(/\n/g)?.length ?? 0) + 1;

const makeModule = (
  path: string,
  code: string,
  jsType = 'js/module'
): FakeModule => ({
  path,
  dependencies: new Map(),
  inverseDependencies: new Set(),
  getSource: () => Buffer.from(code),
  output: [
    {
      type: jsType,
      data: {
        code,
        lineCount: countLines(code),
        map: [],
        functionMap: null,
      },
    },
  ],
});

type FakeGraph = {
  entryPoints: Set<string>;
  transformOptions: {
    type: 'module';
    platform?: string;
    dev: boolean;
    minify: boolean;
    unstable_transformProfile: string;
    customTransformOptions?: Record<string, unknown>;
  };
  dependencies: Map<string, FakeModule>;
};

// Metro's real `ReadOnlyGraph`/`TransformInputOptions` types pull in a lot of
// incidental fields (`type`, a closed `TransformProfile` union, etc.) that
// don't matter for these tests, and `entryPoints` is a mutable `Set` here
// purely for test setup convenience (tests still add to it after creation)
// even though the real type is a `ReadonlySet`. `getHarnessSerializer` below
// casts once to Metro's real types at the call boundary via `TestSerializer`.
const makeGraph = (
  modules: FakeModule[],
  overrides?: Partial<FakeGraph['transformOptions']>
): FakeGraph => ({
  entryPoints: new Set(),
  transformOptions: {
    type: 'module',
    platform: 'ios',
    dev: true,
    minify: false,
    unstable_transformProfile: 'default',
    customTransformOptions: {},
    ...overrides,
  },
  dependencies: new Map(modules.map((mod) => [mod.path, mod])),
});

// A version of `Serializer` typed against our fake graph/module/options
// shapes instead of Metro's real (much larger) types, so call sites in the
// tests below don't need a cast on every argument.
type TestSerializer = (
  entryPoint: string,
  preModules: ReadonlyArray<FakeModule>,
  graph: FakeGraph,
  bundleOptions: ReturnType<typeof makeBundleOptions>
) => ReturnType<Serializer>;

const getHarnessSerializer = (
  options: GetHarnessSerializerOptions
): TestSerializer =>
  getHarnessSerializerImpl(options) as unknown as TestSerializer;

const makeCreateModuleId = () => {
  const ids = new Map<string, number>();
  let nextId = 0;
  return (path: string): number => {
    if (!ids.has(path)) {
      ids.set(path, nextId++);
    }
    return ids.get(path) as number;
  };
};

const makeBundleOptions = (
  overrides: {
    modulesOnly?: boolean;
    createModuleId?: (path: string) => number;
    processModuleFilter?: (mod: FakeModule) => boolean;
  } = {}
) => ({
  asyncRequireModulePath: 'asyncRequire',
  createModuleId: overrides.createModuleId ?? makeCreateModuleId(),
  dev: true,
  getRunModuleStatement: (moduleId: number | string) =>
    `require(${JSON.stringify(moduleId)});`,
  globalPrefix: '',
  includeAsyncPaths: false,
  inlineSourceMap: false,
  modulesOnly: overrides.modulesOnly ?? false,
  processModuleFilter: overrides.processModuleFilter ?? (() => true),
  projectRoot: '/repo',
  runBeforeMainModule: [],
  runModule: false,
  serverRoot: '/repo',
  shouldAddToIgnoreList: () => false,
  sourceMapUrl: undefined,
  sourceUrl: undefined,
  getSourceUrl: () => undefined,
});

const HARNESS_ENTRY = '/repo/node_modules/@react-native-harness/runtime/entry-point.js';
const APP_MODULE = '/repo/src/App.js';
const ASSET_MODULE = '/repo/assets/icon@2x.png';
const TEST_MODULE = '/repo/src/__tests__/example.test.js';

describe('getHarnessSerializer', () => {
  it('captures the main bundle module set only when the entry matches the harness entry point', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');

    // Main bundle: entry matches the harness entry point -> should capture.
    const mainGraph = makeGraph([appModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    const bundleOptions = makeBundleOptions();

    await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    // modulesOnly request that reuses the SAME graph key as the main bundle:
    // appModule should be blanked out since it was captured.
    const testGraph = makeGraph([appModule, testModule]);
    const result = await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    );

    expect((result as { code: string }).code).not.toContain('console.log("app"');
    expect((result as { code: string }).code).toContain('test("x", () => {}');
  });

  it('does not let a non-matching full bundle serialization clobber the captured set', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');
    const debuggerOnlyModule = makeModule(
      '/repo/src/DebuggerOnly.js',
      'console.log("debugger-only");\n'
    );

    const bundleOptions = makeBundleOptions();

    const mainGraph = makeGraph([appModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    // A debugger/browser hitting an arbitrary bundle URL: entry doesn't match
    // the harness entry point, and its graph doesn't even contain appModule.
    // This must NOT overwrite the captured set for this graph key.
    const debuggerGraph = makeGraph([debuggerOnlyModule], {
      // same graph key as the main bundle
    });
    await serializer(
      '/repo/some/other/entry.js',
      [],
      debuggerGraph,
      makeBundleOptions({ createModuleId: bundleOptions.createModuleId })
    );

    const testGraph = makeGraph([appModule, testModule]);
    const result = await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    );

    // appModule should still be blanked -- the debugger pass must not have
    // cleared or replaced the captured set.
    expect((result as { code: string }).code).not.toContain('console.log("app"');
    expect((result as { code: string }).code).toContain('test("x", () => {}');
  });

  it('keys captured sets by graph identity: an iOS capture does not affect an Android modulesOnly request (fail-open)', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');

    const iosBundleOptions = makeBundleOptions();
    const iosGraph = makeGraph([appModule], { platform: 'ios' });
    iosGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(HARNESS_ENTRY, [], iosGraph, iosBundleOptions);

    // Same module paths, but an Android graph -- no capture exists for this
    // key, so the branch must fail open and include everything.
    const androidGraph = makeGraph([appModule, testModule], {
      platform: 'android',
    });
    const androidBundleOptions = makeBundleOptions({
      modulesOnly: true,
      createModuleId: makeCreateModuleId(),
    });
    const result = await serializer(
      TEST_MODULE,
      [],
      androidGraph,
      androidBundleOptions
    );

    expect((result as { code: string }).code).toContain('console.log("app"');
    expect((result as { code: string }).code).toContain('test("x", () => {}');
  });

  it('blanks skipped modules while preserving the exact total line count and leaving other modules byte-identical', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(
      APP_MODULE,
      'console.log("line1");\nconsole.log("line2");\nconsole.log("line3");\n'
    );
    const testModule = makeModule(
      TEST_MODULE,
      'test("keeps this exact code", () => {\n  expect(1).toBe(1);\n});\n'
    );

    const bundleOptions = makeBundleOptions();
    const mainGraph = makeGraph([appModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    const testGraph = makeGraph([appModule, testModule]);
    const testBundleOptions = makeBundleOptions({
      modulesOnly: true,
      createModuleId: bundleOptions.createModuleId,
    });

    const blankedResult = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      testBundleOptions
    )) as { code: string };

    // Compute the unfiltered baseline the same way Metro would, to compare
    // line counts against.
    const unfilteredResult = bundleToString(
      baseJSBundle(TEST_MODULE, [], testGraph, testBundleOptions)
    );

    expect(countLines(blankedResult.code)).toBe(countLines(unfilteredResult.code));

    // appModule's own code should be gone...
    expect(blankedResult.code).not.toContain('line1');
    expect(blankedResult.code).not.toContain('line2');
    expect(blankedResult.code).not.toContain('line3');

    // ...but testModule's code must be untouched (byte-identical wrapping).
    expect(blankedResult.code).toContain('keeps this exact code');
    expect(blankedResult.code).toContain('expect(1).toBe(1)');
  });

  it('builds the captured set from graph.dependencies (asset module paths included, not expanded to variant files)', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const assetModule = makeModule(
      ASSET_MODULE,
      'module.exports = require("./icon.png");\n',
      'js/module/asset'
    );
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');

    const bundleOptions = makeBundleOptions();
    const mainGraph = makeGraph([assetModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    const testGraph = makeGraph([assetModule, testModule]);
    const result = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    )) as { code: string };

    expect(result.code).not.toContain('require("./icon.png")');
    expect(result.code).toContain('test("x", () => {}');
  });

  it('delegates non-modulesOnly serialization to the user-supplied customSerializer', async () => {
    const customSerializer = vi.fn(
      async () => ({ code: 'custom-output', map: '' })
    ) as unknown as Serializer;

    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
      customSerializer,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const mainGraph = makeGraph([appModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    const bundleOptions = makeBundleOptions();

    const result = await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    expect(customSerializer).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ code: 'custom-output', map: '' });

    // Capture must still have happened (read-only, alongside delegation), so
    // a subsequent modulesOnly request still blanks the already-included
    // module.
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');
    const testGraph = makeGraph([appModule, testModule]);
    const testResult = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    )) as { code: string };

    expect(testResult.code).not.toContain('console.log("app"');
    expect(testResult.code).toContain('test("x", () => {}');
  });

  it('fails open (serializes normally) for modulesOnly requests when no set was ever captured', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');
    const testGraph = makeGraph([appModule, testModule]);

    const result = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({ modulesOnly: true })
    )) as { code: string };

    expect(result.code).toContain('console.log("app"');
    expect(result.code).toContain('test("x", () => {}');
  });

  it('still blanks when the main bundle was built with Expo transform options but the test bundle uses defaults', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');

    // Expo main-bundle requests carry transform.* params and a Hermes
    // transform profile (see bundle-url.ts), but the runtime's
    // ?modulesOnly=true test-bundle requests send only modulesOnly +
    // platform, so their graph has default/empty transform options. The
    // graph key must ignore those dimensions -- keying on them would make
    // the lookup miss on every Expo test bundle and silently turn the
    // feature into a permanent no-op.
    const bundleOptions = makeBundleOptions();
    const mainGraph = makeGraph([appModule], {
      unstable_transformProfile: 'hermes-stable',
      customTransformOptions: {
        engine: 'hermes',
        bytecode: '1',
        routerRoot: 'app',
        reactCompiler: 'true',
      },
    });
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(HARNESS_ENTRY, [], mainGraph, bundleOptions);

    // Same platform/dev/minify, default transform options.
    const testGraph = makeGraph([appModule, testModule]);
    const result = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    )) as { code: string };

    expect(result.code).not.toContain('console.log("app"');
    expect(result.code).toContain('test("x", () => {}');
  });

  it('honors the Expo virtual entry by matching it via graph.entryPoints', async () => {
    const serializer = getHarnessSerializer({
      harnessEntryPointPath: HARNESS_ENTRY,
    });

    const appModule = makeModule(APP_MODULE, 'console.log("app");\n');
    const testModule = makeModule(TEST_MODULE, 'test("x", () => {});\n');

    // Expo requests the virtual entry, which the harness resolver maps to
    // the same harness entry-point module; graph.entryPoints reflects the
    // resolved path even when the literal `entryPoint` string argument
    // doesn't.
    const bundleOptions = makeBundleOptions();
    const mainGraph = makeGraph([appModule]);
    mainGraph.entryPoints.add(HARNESS_ENTRY);
    await serializer(
      '/repo/.expo/.virtual-metro-entry',
      [],
      mainGraph,
      bundleOptions
    );

    const testGraph = makeGraph([appModule, testModule]);
    const result = (await serializer(
      TEST_MODULE,
      [],
      testGraph,
      makeBundleOptions({
        modulesOnly: true,
        createModuleId: bundleOptions.createModuleId,
      })
    )) as { code: string };

    expect(result.code).not.toContain('console.log("app"');
  });
});
