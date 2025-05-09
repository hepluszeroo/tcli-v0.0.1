const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const path = require('path');
const sharedAliases = require(path.resolve(__dirname, '../../../webpack.aliases.js'));

// Define valid modes
const VALID_MODES = ['development', 'production', 'none'];

// Safety guard to prevent invalid webpack mode
if (!VALID_MODES.includes(process.env.NODE_ENV)) {
  console.warn(`Unsupported NODE_ENV "${process.env.NODE_ENV}" for webpack build, falling back to "development"`);
}

// Ensure mode is always valid
const MODE = VALID_MODES.includes(process.env.NODE_ENV) 
  ? process.env.NODE_ENV 
  : 'development';

// Check if this is an E2E test build
const isE2eTest = process.env.E2E_TEST === '1';

const prod = MODE === 'production';

module.exports = {
  entry: {
    'bundle/main': ['./src/testing/e2e_stub/main.ts'],
    'bundle/codex_process_manager': ['./src/main/codex_process_manager.ts']
  },

  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.cjs'],
    plugins: [new TsConfigPathsPlugin()],
    alias: {
      'typewriter-editor/dist/rendering/vdom': path.resolve(__dirname, '../../shims/typewriter-vdom-shim.js'),
      'typewriter-editor': path.resolve(__dirname, '../../shims/typewriter-editor-shim.js'),
      ...sharedAliases,
    },
  },

  output: {
    path: path.join(__dirname, '../../../__build'),
    filename: '[name].js',
    chunkFilename: '[name].[id].js'
  },

  target: 'electron-main',

  module: {
    rules: [
      {
        test: /\.js$/,
        resolve: { fullySpecified: false }
      },
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            onlyCompileBundledFiles: true,
            configFile: path.resolve(__dirname, '../../../tsconfig.main.json')
          }
        },
        exclude: [/node_modules/, /tests/]
      }
    ]
  },

  externalsPresets: { electron: true, node: true },

  externals: {
    fsevents: 'commonjs fsevents',
    'electron-reload': 'commonjs electron-reload',
    'font-list': 'commonjs font-list',
    yargs: 'commonjs yargs',
    'yargs/helpers': 'commonjs yargs/helpers',
    'link-preview-js': 'commonjs link-preview-js',
    // Let the real runtime `require()` handle the dynamic load;
    // Webpack should just leave it as-is.
    './build/Release/codex_native.node': 'commonjs2 ./build/Release/codex_native.node'
  },

  mode: MODE,
  devtool: prod ? 'nosources-source-map' : 'eval-source-map'
};