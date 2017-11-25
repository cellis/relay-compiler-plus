'use strict';

var nodeExternals = require('webpack-node-externals');
var path = require('path');

module.exports = {
  entry: [],
  target: 'node', // ignore built-in modules like path, fs, etc.
  node: {
    __dirname: false
  },
  externals: [nodeExternals()], // ignore all modules in node_modules folder
  output: {
    path: path.resolve('.'),
    filename: 'graphql-js-transpiled.js',
    pathinfo: true,
    libraryTarget: 'commonjs2'
  },
  module: {
    rules: [{
      // We must exclude any const of universal/redux/store
      test: /\.js$/,
      loader: 'babel-loader',
      exclude: /node_modules/,
      options: {
        babelrc: false,
        presets: ['flow', ['env', { modules: 'commonjs' }], 'stage-0'],
        plugins: ['transform-flow-strip-types', 'transform-decorators-legacy', 'transform-async-to-generator']
      }
    }]
  }
};