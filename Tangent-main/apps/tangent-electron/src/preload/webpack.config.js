const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const path = require('path');
const sharedAliases = require(path.resolve(__dirname, '../../webpack.aliases.js'));

// TODO: Make this not a copy paste
const mode = process.env.NODE_ENV || 'production';
const prod = mode === 'production';

module.exports = {
	entry: {
		'bundle/preload': ['./src/preload/index.ts']
	},
	resolve: {
			alias: {
				...sharedAliases,
				'@such-n-such/tangent-query-parser': path.resolve(__dirname, '../empty_stub.ts'),
			},
			extensions: ['.mjs', '.js', '.ts', '.cjs'],
		plugins: [
			new TsConfigPathsPlugin()
		]
	},
	output: {
		path: path.join(__dirname, '../../__build'),
		filename: '[name].js',
		chunkFilename: '[name].[id].js'
	},
	target: 'electron-preload',
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
						configFile: path.resolve(__dirname, '../../tsconfig.json')
					}
				},
				exclude: /node_modules/
			}
		]
	},
	externals: {
		externalsPresets: {
			electron: true
		}
	},
	mode,
	// Good source maps in prod, faster-ish maps in dev: https://webpack.js.org/configuration/devtool/#devtool
	devtool: prod ? 'nosources-source-map' : 'eval-source-map'
};
