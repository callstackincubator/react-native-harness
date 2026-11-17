// Rewrites `mock('x')`, `unmock('x')` and `requireActual('x')` from
// `react-native-harness` to take the module's id, `require.resolveWeak('x')`.
//
// It parses the source and changes nothing else, and it ignores the project's
// Babel config, so it runs before whichever transpiler the project uses. The
// result is still TypeScript or JSX as written. A file it cannot parse is
// passed on unchanged with a warning: the project's own loader reports the
// real error, if there is one.
//
// While Jest collects coverage it also instruments the file, the way Metro's
// Babel preset does. It does so on the source as written, so the report's
// lines are those of the original TypeScript, whichever transpiler follows.
// The rule that applies the loader leaves out node_modules and Harness's own
// packages.
const path = require('node:path');
const babel = require('@babel/core');
const {
  getIstanbulPlugin: getBabelPresetIstanbulPlugin,
} = require('@react-native-harness/babel-preset/istanbul-plugin');
const resolveWeakPlugin =
  require('@react-native-harness/babel-preset/resolve-weak-plugin').default;

const getSyntaxPlugins = (file) => {
  if (/\.[cm]?ts$/.test(file)) {
    return ['typescript', 'decorators-legacy'];
  }

  if (/\.tsx$/.test(file)) {
    return ['typescript', 'jsx', 'decorators-legacy'];
  }

  return ['jsx'];
};

// The plugin and options `babel-preset` gives Metro, from the same environment
// variables. Babel looks a plugin up by name from the working directory, so the
// name is resolved from `babel-preset`, which depends on it.
const getIstanbulPlugin = () => {
  const plugin = getBabelPresetIstanbulPlugin();

  if (!plugin) {
    return null;
  }

  const [name, options] = Array.isArray(plugin) ? plugin : [plugin, {}];
  const presetDirectory = path.dirname(
    require.resolve('@react-native-harness/babel-preset/package.json')
  );

  return [require.resolve(name, { paths: [presetDirectory] }), options];
};

module.exports = function resolveWeakLoader(source, inputMap) {
  const callback = this.async();
  const istanbulPlugin = getIstanbulPlugin();

  // The plugin only acts on imports from this package.
  if (!istanbulPlugin && !source.includes('react-native-harness')) {
    callback(null, source, inputMap);
    return;
  }

  babel
    .transformAsync(source, {
      filename: this.resourcePath,
      // Without it Babel names the source after the file alone, and the final
      // map cannot say which file a frame is in.
      sourceFileName: this.resourcePath,
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      sourceMaps: this.sourceMap,
      inputSourceMap: inputMap || undefined,
      retainLines: true,
      compact: false,
      parserOpts: { plugins: getSyntaxPlugins(this.resourcePath) },
      plugins: istanbulPlugin ? [resolveWeakPlugin, istanbulPlugin] : [resolveWeakPlugin],
    })
    .then(
      (result) => callback(null, result.code, result.map ?? undefined),
      (error) => {
        this.emitWarning(
          new Error(
            `React Native Harness could not read ${this.resourcePath} to look for mock(), unmock() and requireActual() calls, and left it as it is: ${error.message}`
          )
        );
        callback(null, source, inputMap);
      }
    );
};
