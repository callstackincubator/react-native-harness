import {
  createEntryPointMatcher,
  describeEntry,
  getEntryPointPattern,
  type ResolveData,
} from './entry-point.js';

const PLUGIN_NAME = 'ReactNativeHarnessPlugin';

export type HarnessPluginOptions = {
  projectRoot: string;
  /** `entryPoint` of the Harness config. */
  entryPoint: string;
  /** The module that replaces the module at `entryPoint`. */
  harnessEntry: string;
  /** The `entry` of the project's config, for messages. */
  entry?: unknown;
};

type Tap<TArgs extends unknown[]> = {
  tap: (name: string, callback: (...args: TArgs) => void) => void;
};

type PluginCompilation = {
  errors: unknown[];
  hooks: {
    additionalTreeRuntimeRequirements: Tap<[unknown, Set<string>]>;
    finishModules: Tap<[unknown]>;
  };
};

// What the plugin uses of webpack and Rspack, which both provide it.
type PluginCompiler = {
  webpack: {
    RuntimeGlobals: Record<string, string>;
    NormalModuleReplacementPlugin: new (
      pattern: RegExp,
      replace: (data: ResolveData) => void
    ) => { apply: (compiler: PluginCompiler) => void };
  };
  hooks: {
    // Not copied to child compilers, such as the HTML plugin's.
    thisCompilation: Tap<[PluginCompilation]>;
  };
};

/**
 * Replaces the app's entry with the Harness entry, and adds to the build what
 * module mocking needs: the module cache and the hook that runs before a
 * module executes (`__webpack_require__.c` and `.i`), and the module
 * factories (`.m`).
 */
export class HarnessPlugin {
  constructor(private readonly options: HarnessPluginOptions) {}

  apply(compiler: PluginCompiler): void {
    const { RuntimeGlobals, NormalModuleReplacementPlugin } = compiler.webpack;
    const { projectRoot, entryPoint, harnessEntry, entry } = this.options;
    const isEntryPoint = createEntryPointMatcher({ projectRoot, entryPoint });
    let replaced = false;

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        PLUGIN_NAME,
        (_chunk, requirements) => {
          requirements.add(RuntimeGlobals.interceptModuleExecution);
          requirements.add(RuntimeGlobals.moduleCache);
          requirements.add(RuntimeGlobals.moduleFactories);
        }
      );

      compilation.hooks.finishModules.tap(PLUGIN_NAME, () => {
        if (!replaced) {
          compilation.errors.push(
            new Error(
              `React Native Harness: no module of the build is the entryPoint "${entryPoint}" of the Harness config, so the Harness runtime was not added. ` +
                `entryPoint is resolved from the project root and must name the same file as the "entry" of your config, as the request is written there, before any alias. The config's entry is ${describeEntry(entry)}.`
            )
          );
        }
      });
    });

    // The request has to be replaced before it is resolved, so that the
    // loaders and the module type are those of the Harness entry. A request
    // that only matches once resolved (reached through an alias) would keep
    // the loaders of the app's entry.
    new NormalModuleReplacementPlugin(
      getEntryPointPattern(entryPoint),
      (data) => {
        if (!isEntryPoint(data)) {
          return;
        }

        if (data.createData?.resource !== undefined) {
          // The entry was swapped already: this is another module reaching
          // the entry file, which is left as it is.
          if (replaced) {
            return;
          }

          throw new Error(
            `React Native Harness: the entryPoint "${entryPoint}" of the Harness config was only recognized after the request was resolved (${data.createData.resource}), through an alias or a resolver. ` +
              'entryPoint is resolved from the project root and must name the same file as the "entry" of your config, as the request is written there, before any alias.'
          );
        }

        replaced = true;
        data.request = harnessEntry;
      }
    ).apply(compiler);
  }
}
