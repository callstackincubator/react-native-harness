// Rewrites `mock('x')`, `unmock('x')` and `requireActual('x')` from
// `react-native-harness` to take the module's id, `require.resolveWeak('x')`.
//
// It parses the source and changes nothing else, and it ignores the project's
// Babel config, so it runs before whichever transpiler the project uses. The
// result is still TypeScript or JSX as written. A file it cannot parse is
// passed on unchanged with a warning: the project's own loader reports the
// real error, if there is one.
const babel = require('@babel/core');
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

module.exports = function resolveWeakLoader(source, inputMap) {
  const callback = this.async();

  // The plugin only acts on imports from this package.
  if (!source.includes('react-native-harness')) {
    callback(null, source, inputMap);
    return;
  }

  babel
    .transformAsync(source, {
      filename: this.resourcePath,
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      sourceMaps: this.sourceMap,
      inputSourceMap: inputMap || undefined,
      retainLines: true,
      compact: false,
      parserOpts: { plugins: getSyntaxPlugins(this.resourcePath) },
      plugins: [resolveWeakPlugin],
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
