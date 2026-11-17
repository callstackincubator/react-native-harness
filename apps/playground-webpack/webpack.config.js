const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const { browserslist } = require('./package.json');

/** @type {import('webpack').Configuration} */
module.exports = {
  // Resolve everything relative to this folder, whatever the working directory.
  context: __dirname,
  entry: './src/index.tsx',
  output: {
    path: path.join(__dirname, 'dist/webpack'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    alias: {
      // Mirrored in the `paths` option of tsconfig.app.json.
      '@app': path.join(__dirname, 'src'),
      'react-native$': 'react-native-web',
    },
    // `.web.*` files win over the platform-neutral ones, as in Metro.
    extensions: [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      '.tsx',
      '.ts',
      '.jsx',
      '.js',
      '.json',
    ],
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        // node_modules is deliberately not transpiled. A deep import such as
        // `react-native/Libraries/...` (Flow source) fails the build.
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          babelrc: false,
          configFile: false,
          // Same targets as the Rspack build: the `browserslist` field in
          // package.json, passed explicitly so it is found from any directory.
          presets: [
            ['@babel/preset-env', { targets: browserslist }],
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript',
          ],
        },
      },
      {
        // Imported as a URL string.
        test: /\.svg$/,
        type: 'asset/resource',
        generator: { filename: 'assets/[name].[contenthash:8][ext]' },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: path.join(__dirname, 'index.html') }),
    // Build-time constant, declared in src/globals.d.ts.
    new webpack.DefinePlugin({
      __BUILD_LABEL__: JSON.stringify('harness-webpack-fixture'),
    }),
  ],
  devServer: { port: 3000 },
};
