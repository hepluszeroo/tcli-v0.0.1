const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const path = require('path');
const sharedAliases = require(path.resolve(__dirname, '../../webpack.aliases.js'));

const mode  = process.env.NODE_ENV || 'production';
const prod  = mode === 'production';

module.exports = {
	entry: {
		'bundle/main': ['./src/main/index.ts']
	},

	resolve: {
		extensions: ['.mjs', '.js', '.ts', '.cjs'],
		alias: {
			// Project-wide shared shims
			...sharedAliases,
			// Additional stubs specific to the main bundle
			'@such-n-such/tangent-query-parser': path.resolve(__dirname, '../empty_stub.ts'),
		},
		plugins: [new TsConfigPathsPlugin()]
	},

	output: {
		path:          path.join(__dirname, '../../__build'),
		filename:      '[name].js',
		chunkFilename: '[name].[id].js'
	},

	target: 'electron-main',

	module: {
		rules: [
			{
				test:    /\.js$/,
				resolve: { fullySpecified: false }
			},
			{
				test: /\.ts$/,
				use:  {
					loader:  'ts-loader',
					options: {
						transpileOnly:           true,
						onlyCompileBundledFiles: true,
						configFile:              path.resolve(__dirname, '../../tsconfig.main.json')
					}
				},
				exclude: [/node_modules/, /tests/]
			}
		]
	},

	externalsPresets: { electron: true, node: true },

	// keep only the real externals – no typewriter-editor or query-parser paths here
	externals: {
		fsevents:         'commonjs fsevents',
		//'electron':     'commonjs electron',
		'electron-reload': 'commonjs electron-reload',
		'font-list':       'commonjs font-list',
		yargs:             'commonjs yargs',
		'yargs/helpers':   'commonjs yargs/helpers',
		'link-preview-js': 'commonjs link-preview-js'
	},

	mode,
	devtool: prod ? 'nosources-source-map' : 'eval-source-map'
};
