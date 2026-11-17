// Build-time constant injected by DefinePlugin (see webpack.config.js and rspack.config.js).
declare const __BUILD_LABEL__: string;

// `asset/resource` modules resolve to the URL of the emitted file.
declare module '*.svg' {
  const url: string;
  export default url;
}
