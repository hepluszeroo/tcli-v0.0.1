const path = require('path');
const fs   = require('fs');

const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TsConfigPathsPlugin  = require('tsconfig-paths-webpack-plugin');

const mode = process.env.NODE_ENV || 'production';
const prod = mode === 'production';

/* ------------------------------------------------------------------------- *
 * Helpers                                                                   *
 * ------------------------------------------------------------------------- */
function findAndResolvePath (partialPath) {
	/*
	 * The location of `node_modules` can vary with pnpm’s hoisting strategy.
	 * Walk upwards until the requested file is discovered or we give up.
	 */
	let candidate = partialPath;
	let attempts  = 10;

	while (attempts-- > 0) {
		const resolved = path.resolve(candidate);

		try {
			fs.statSync(resolved);
			console.log('Resolved', partialPath, '→', resolved);
			return resolved;
		} catch {
			candidate = path.join('..', candidate);
		}
	}

	console.warn('Failed to resolve', partialPath);
	return undefined;
}

/* ------------------------------------------------------------------------- *
 * Shared constants                                                          *
 * ------------------------------------------------------------------------- */
const STUB_PATH = path.resolve(__dirname, '../empty_stub.ts');

/**
 * We replace every Typewriter-related (and some other optional) imports with
 * a tiny stub so the heavy dependency tree never gets pulled in.
 *
 * Important: **Do not** list the same module in `externals`, otherwise the
 * alias will be ignored and the runtime will try to load the real package,
 * resulting in “Cannot find module …”.
 */
const stubbedTypewriterModules = [
	// Root entry deliberately omitted; we alias it separately with an exact
	// match (trailing "$") so that deeper imports are handled by their own
	// stubs before the generic root alias triggers.
	'typewriter-editor/dist/typesetting',
	'typewriter-editor/dist/stores',
	'typewriter-editor/dist/popper',
	'typewriter-editor/dist/asRoot',
	'typewriter-editor/dist/util/EventDispatcher',
	'typewriter-editor/dist/modules/copy',
	// Explicitly stub the VDOM entry – this one tended to slip through.
	'typewriter-editor/dist/rendering/vdom',
	// Most common nested paths (add more only if they cause errors)
	'typewriter-editor/dist/rendering/vdom/index',
	'typewriter-editor/dist/rendering/vdom/utils'
];

/* ------------------------------------------------------------------------- *
 * Aliases                                                                   *
 * ------------------------------------------------------------------------- */
const alias = {
	// Force the Svelte runtime bundle.
	svelte: findAndResolvePath('node_modules/svelte/src/runtime'),

	// Optional dependency used only in certain builds/tests.
	'@such-n-such/tangent-query-parser': STUB_PATH,

	// Dynamically add all explicit Typewriter stubs.
	// Add an *exact-match* root package alias to avoid swallowing nested
	// sub-paths before more specific aliases have a chance to match.
	'typewriter-editor$': STUB_PATH,
	...Object.fromEntries(stubbedTypewriterModules.map(m => [m, STUB_PATH])),

	// Catch *any* nested import underneath the VDOM folder (e.g.
	// “…/vdom/index”, “…/vdom/whatever.js”, etc.).
	[/^typewriter-editor\/dist\/rendering\/vdom(\/.*)?$/]: STUB_PATH
};

/* ------------------------------------------------------------------------- *
 * Webpack configuration                                                     *
 * ------------------------------------------------------------------------- */
module.exports = {
	entry: {
		'bundle/app': ['./src/app/app.js']
	},

	resolve: {
		alias,
		extensions: ['.mjs', '.js', '.svelte', '.ts'],
		mainFields:  ['svelte', 'browser', 'module', 'main'],
		conditionNames: ['svelte', 'browser', 'import'],
		plugins: [new TsConfigPathsPlugin()]
	},

	output: {
		path:          path.join(__dirname, '../../__build'),
		filename:      '[name].js',
		chunkFilename: '[name].[id].js'
	},

	target: 'electron-renderer',

	module: {
		rules: [
			{
				test: /\.svelte$/,
				use:  {
					loader:  'svelte-loader',
					options: {
						compilerOptions: { dev: !prod },
						emitCss:         prod,
						hotReload:       !prod,
						preprocess:      require('../../svelte.config').preprocess,
						onwarn (warning, handler) {
							// Silence specific (often noisy) accessibility warnings.
							const ignore = new Set([
								'a11y-click-events-have-key-events',
								'a11y-no-noninteractive-tabindex',
								'a11y-no-noninteractive-element-interactions',
								'a11y-no-static-element-interactions'
							]);

							if (!ignore.has(warning.code)) handler(warning);
						}
					}
				}
			},
			{
				test:    /\.js$/,
				resolve: { fullySpecified: false }
			},
			{
				test:    /\.ts$/,
				exclude: /node_modules/,
				use:     {
					loader:  'ts-loader',
					options: {
						transpileOnly:           true,
						onlyCompileBundledFiles: true,
						configFile:              path.resolve(__dirname, '../../tsconfig.json')
					}
				}
			},
			{
				test: /\.(scss|sass)$/,
				use:  [
					MiniCssExtractPlugin.loader,
					{
						loader:  'css-loader',
						options: { url: false }
					},
					'sass-loader'
				]
			},
			{
				test: /\.css$/,
				use:  [
					MiniCssExtractPlugin.loader,
					{
						loader:  'css-loader',
						options: { url: false }
					}
				]
			},
			{
				// Prevent Webpack 5 “fully specified” errors inside Svelte ESM.
				test: /node_modules\/svelte\/.*\.mjs$/,
				resolve: { fullySpecified: false }
			}
		]
	},

	/*
	 * Nothing is marked as external here: any module we stub via alias
	 * must be bundled, otherwise the stub would be bypassed.
	 */
	externals: {},

	mode,

	plugins: [
		new MiniCssExtractPlugin({ filename: '[name].css' })
	],

	// High-quality maps in prod, faster maps in dev.
	devtool: prod ? 'nosources-source-map' : 'eval-source-map',

	devServer: { hot: true }
};
