/**
 * External dependencies
 */
const { get } = require( 'lodash' );
const path = require( 'path' );
const fs = require( 'fs' );
const CopyWebpackPlugin = require( 'copy-webpack-plugin' );
const { BundleAnalyzerPlugin } = require( 'webpack-bundle-analyzer' );
const ReactRefreshWebpackPlugin = require( '@pmmmwh/react-refresh-webpack-plugin' );
const webpack = require( 'webpack' );

/**
 * Internal dependencies
 */
const CustomTemplatedPathPlugin = require( './bin/custom-templated-path-webpack-plugin' );
const UnminifyWebpackPlugin = require( './bin/unminify-webpack-plugin.js' );
const {
	webpackConfig: styleConfig,
} = require( '@woocommerce/internal-style-build' );
const WooCommerceDependencyExtractionWebpackPlugin = require( '@woocommerce/dependency-extraction-webpack-plugin/src/index' );

const NODE_ENV = process.env.NODE_ENV || 'development';
const WC_ADMIN_PHASE = process.env.WC_ADMIN_PHASE || 'development';
const isHot = Boolean( process.env.HOT );
const isProduction = NODE_ENV === 'production';
const isWatch = ! isProduction && process.argv.includes( '--watch' );

const getSubdirectoriesAt = ( searchPath ) => {
	const dir = path.resolve( __dirname, searchPath );
	return fs
		.readdirSync( dir, { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => entry.name );
};

const WC_ADMIN_PACKAGES_DIR = '../../../../packages/js';
const WP_ADMIN_SCRIPTS_DIR = './client/wp-admin-scripts';

// Admin's webpack writes directly to the WooCommerce plugin's
// `assets/client/admin/` directory so PHP can enqueue files from their final
// location without an intermediate copy step. The JS config and every
// loaded-from-packages CSS config use this constant for `output.path`.
const BUILD_DIR = path.resolve( __dirname, '../../assets/client/admin' );

// wpAdminScripts are loaded on wp-admin pages outside the context of WooCommerce Admin
// See ./client/wp-admin-scripts/README.md for more details
const wpAdminScripts = getSubdirectoriesAt( WP_ADMIN_SCRIPTS_DIR ); // automatically include all subdirs
const wcAdminPackages = [
	// we use a whitelist for this instead of dynamically generating it because not all folders are packages meant for consumption
	'admin-layout',
	'components',
	'csv-export',
	'currency',
	'customer-effort-score',
	'date',
	'experimental-products-app',
	'experimental',
	'explat',
	'navigation',
	'notices',
	'number',
	'data',
	'tracks',
	'onboarding',
	'block-templates',
	'product-editor',
	'sanitize',
	'settings-editor',
	'remote-logging',
	'email-editor',
];

// Workspace packages that admin doesn't expose as their own `window.wc.<name>`
// entry, but which other workspace packages import transitively. They need a
// source alias so admin's webpack can resolve and bundle them inline (no
// cascade) — without the alias, Node resolution would fall back to
// `<pkg>/build-module/index.js`, which only exists if the package was built
// first.
const wcAdminInternalDeps = [ 'expression-evaluation' ];

const getEntryPoints = () => {
	const entryPoints = {
		app: './client/index.tsx',
		embed: './client/embed.tsx',
		settings: './client/settings/index.js',
	};
	wcAdminPackages.forEach( ( name ) => {
		entryPoints[ name ] = `${ WC_ADMIN_PACKAGES_DIR }/${ name }/src`;
	} );
	wpAdminScripts.forEach( ( name ) => {
		entryPoints[ name ] = `${ WP_ADMIN_SCRIPTS_DIR }/${ name }`;
	} );
	return entryPoints;
};

// WordPress.org’s translation infrastructure ignores files named “.min.js” so we need to name our JS files without min when releasing the plugin.
const outputSuffix = WC_ADMIN_PHASE === 'core' ? '' : '.min';

const jsConfig = {
	name: 'admin-js',
	mode: NODE_ENV,
	performance: {
		hints: false,
	},
	cache:
		isWatch || process.env.CI || process.env.HOT || process.env.STORYBOOK
			? { type: 'memory' }
			: {
					type: 'filesystem',
					cacheDirectory: path.resolve(
						__dirname,
						`node_modules/.cache/webpack-${ WC_ADMIN_PHASE }`
					),
					buildDependencies: {
						config: [
							__filename,
							path.resolve(
								__dirname,
								'../../../../pnpm-lock.yaml'
							),
							require.resolve(
								'@woocommerce/dependency-extraction-webpack-plugin'
							),
							require.resolve(
								'@woocommerce/internal-style-build'
							),
						],
					},
			  },
	entry: getEntryPoints(),
	output: {
		filename: ( data ) => {
			// Output wpAdminScripts to wp-admin-scripts folder
			// See https://github.com/woocommerce/woocommerce-admin/pull/3061
			return wpAdminScripts.includes( data.chunk.name )
				? `wp-admin-scripts/[name]${ outputSuffix }.js`
				: `[name]/index${ outputSuffix }.js`;
		},
		chunkFilename: `chunks/[name]${ outputSuffix }.js?ver=[contenthash]`,
		path: BUILD_DIR,
		library: {
			// Expose the exports of entry points so we can consume the libraries in window.wc.[modulename] with WooCommerceDependencyExtractionWebpackPlugin.
			name: [ 'wc', '[modulename]' ],
			type: 'window',
		},
		// A unique name of the webpack build to avoid multiple webpack runtimes to conflict when using globals.
		uniqueName: '__wcAdmin_webpackJsonp',
	},
	module: {
		parser: styleConfig.parser,
		rules: [
			{
				test: /\.(t|j)sx?$/,
				parser: {
					// Disable AMD to fix an issue where underscore and lodash where clashing
					// See https://github.com/woocommerce/woocommerce-admin/pull/1004 and https://github.com/Automattic/woocommerce-services/pull/1522
					amd: false,
				},
				exclude: [
					/[\/\\]node_modules[\/\\]\.pnpm[\/\\]/,
					/[\/\\](changelog|bin|build|docs|test)[\/\\]/,
				],
				use: {
					loader: 'babel-loader',
					options: {
						// Prevent babel.config.js (Jest/Node context) from merging into this browser build and duplicating presets.
						configFile: false,
						sourceType: 'unambiguous',
						presets: [ '@wordpress/babel-preset-default' ],
						plugins: [
							! isProduction &&
								isHot &&
								require.resolve( 'react-refresh/babel' ),
							isProduction &&
								require.resolve(
									'babel-plugin-transform-react-remove-prop-types'
								),
						].filter( Boolean ),
						cacheDirectory: path.resolve(
							__dirname,
							'../../../../node_modules/.cache/babel-loader'
						),
						cacheCompression: false,
					},
				},
			},
			{ test: /\.md$/, use: 'raw-loader' },
			{
				test: /\.(png|jpe?g|gif|svg|eot|ttf|woff|woff2)$/,
				type: 'asset',
			},
			...styleConfig.rules,
		],
	},
	resolve: {
		fallback: {
			// Reduce bundle size by omitting Node crypto library.
			// See https://github.com/woocommerce/woocommerce-admin/pull/5768
			crypto: 'empty',
			// Ignore fs, path to skip resolve errors for @automattic/calypso-config
			fs: false,
			path: false,
		},
		extensions: [ '.json', '.js', '.jsx', '.ts', '.tsx' ],
		alias: {
			'~': path.resolve( __dirname + '/client' ),
			// Resolve `@woocommerce/*` workspace packages to source so admin's
			// webpack transpiles them in-place (no JS cascade). `$` makes the
			// bare-name alias exact so deep imports like
			// `@woocommerce/data/foo` still resolve via the package-root
			// alias below. Covers both entry-point packages and any
			// transitively-imported internal deps.
			...Object.fromEntries(
				[ ...wcAdminPackages, ...wcAdminInternalDeps ].flatMap(
					( name ) => {
						const pkgRoot = path.resolve(
							__dirname,
							`${ WC_ADMIN_PACKAGES_DIR }/${ name }`
						);
						return [
							[ `@woocommerce/${ name }$`, `${ pkgRoot }/src` ],
							[ `@woocommerce/${ name }`, pkgRoot ],
						];
					}
				)
			),
		},
	},
	plugins: [
		...styleConfig.plugins,
		// Ignore SCSS imports coming from workspace packages and node_modules
		// in this (JS) compiler. The dedicated `cssConfig` below compiles
		// each workspace package's `src/style.scss` to `<pkg>/style.css`.
		// Admin's own SCSS (under `client/`) still flows through MiniCss.
		new webpack.IgnorePlugin( {
			resourceRegExp: /\.s?css$/,
			contextRegExp:
				/[\/\\]packages[\/\\]js[\/\\]|[\/\\]node_modules[\/\\]/,
		} ),
		// Substitute the `__i18n_text_domain__` identifier used by the
		// @woocommerce/email-editor package with the WooCommerce text
		// domain so strings extract and translate under `woocommerce`.
		new webpack.DefinePlugin( {
			__i18n_text_domain__: JSON.stringify( 'woocommerce' ),
		} ),
		new CustomTemplatedPathPlugin( {
			modulename( outputPath, data ) {
				const entryName = get( data, [ 'chunk', 'name' ] );
				if ( entryName ) {
					// Convert the dash-case name to a camel case module name.
					// For example, 'csv-export' -> 'csvExport'
					return entryName.replace( /-([a-z])/g, ( match, letter ) =>
						letter.toUpperCase()
					);
				}
				return outputPath;
			},
		} ),
		// Copy product editor block.json files from source so PHP's
		// BlockRegistry can load them.
		new CopyWebpackPlugin( {
			patterns: [
				{
					from: path.join(
						__dirname,
						'../../../../packages/js/product-editor/src/blocks'
					),
					to: './product-editor/blocks',
				},
			],
		} ),

		// React Fast Refresh.
		! isProduction && isHot && new ReactRefreshWebpackPlugin(),

		// We reuse this Webpack setup for Storybook, where we need to disable dependency extraction.
		! process.env.STORYBOOK &&
			new WooCommerceDependencyExtractionWebpackPlugin( {
				requestToExternal( request ) {
					switch ( request ) {
						case 'moment-timezone':
							// Use WordPress core's window.moment (which includes moment-timezone)
							// instead of bundling a stripped copy.
							return 'moment';
						case '@wordpress/global-styles-engine':
							// @wordpress/global-styles-engine is not a standard WordPress package available globally,
							// so we need to bundle it instead of treating it as an external.
							return null;
					}

					if ( request.startsWith( '@wordpress/dataviews' ) ) {
						return null;
					}

					if ( request.startsWith( '@wordpress/theme' ) ) {
						return null;
					}

					if ( request.startsWith( '@wordpress/ui' ) ) {
						return null;
					}

					// Skip requesting to external if the import path is from the build or build-module directory for WordPress packages.
					// This is required for @wordpress/edit-site to work and also can reduce the bundle size when we don't need to load the entire WordPress package.
					if (
						request.match( /^@wordpress\/.*\/build(?:-module)?/ )
					) {
						return null;
					}

					// Skip requesting to external if the import path is from the build or build-module directory for WooCommerce packages.
					// This can reduce the bundle size when we don't need to load the entire WooCommerce package.
					if (
						request.match( /^@woocommerce\/.*\/build(?:-module)?/ )
					) {
						return null;
					}
				},
				requestToHandle( request ) {
					if ( request === 'moment-timezone' ) {
						return 'moment';
					}
				},
			} ),
		process.env.ANALYZE && new BundleAnalyzerPlugin(),
		// We only want to generate unminified files in the development phase.
		WC_ADMIN_PHASE === 'development' &&
			// Generate unminified files to load the unminified version when `define( 'SCRIPT_DEBUG', true );` is set in wp-config.
			new UnminifyWebpackPlugin( {
				test: /\.js($|\?)/i,
				mainEntry: 'app/index.min.js',
			} ),
	].filter( Boolean ),
	optimization: {
		minimize: NODE_ENV !== 'development',
		splitChunks: {
			// Not to generate chunk names because it caused a stressful workflow when deploying the plugin to WP.org
			// See https://github.com/woocommerce/woocommerce-admin/pull/5229
			name: false,
		},
	},
};
if ( ! isProduction || WC_ADMIN_PHASE === 'development' ) {
	// Set default sourcemap mode if it wasn't set by WP_DEVTOOL.
	jsConfig.devtool = jsConfig.devtool || 'source-map';

	if ( isHot ) {
		// Add dev server config
		// Copied from https://github.com/WordPress/gutenberg/blob/05bea6dd5c6198b0287c41a401d36a06b48831eb/packages/scripts/config/webpack.config.js#L312-L326
		jsConfig.devServer = {
			devMiddleware: {
				writeToDisk: true,
			},
			allowedHosts: 'auto',
			host: 'localhost',
			port: 8887,
			proxy: {
				'/assets/client/admin': {
					pathRewrite: {
						'^/assets/client/admin': '',
					},
				},
			},
		};
	}
}

// Load each workspace package's own webpack.config.js (which produces SCSS
// outputs) and add them to the multi-compiler array so a single webpack
// invocation builds everything. Each package's config is rewritten to:
//   1. Get a `name` so `jsConfig.dependencies` can reference it for ordering.
//   2. Have its `output.path` redirected from the package's own dir to admin's
//      `build/` so artifacts land where PHP enqueues them.
//   3. Have its `build-style` entry renamed to `<pkg>` so MiniCss emits to
//      `<pkg>/style.css` instead of `build-style/style.css`.
const packageCssConfigs = wcAdminPackages.flatMap( ( name ) => {
	const cfgPath = path.resolve(
		__dirname,
		`${ WC_ADMIN_PACKAGES_DIR }/${ name }/webpack.config.js`
	);
	if ( ! fs.existsSync( cfgPath ) ) {
		return [];
	}
	const cfg = require( cfgPath );
	return [
		{
			...cfg,
			name,
			entry: Object.fromEntries(
				Object.entries( cfg.entry ).map( ( [ key, value ] ) => {
					// Standalone, each package's config writes outputs under
					// its own directory using filename patterns that assume
					// its `output.path` IS the package dir. When composed
					// into admin's build (output.path = BUILD_DIR), we
					// re-prefix entry names with `<pkg>/` so files land at
					// `<BUILD_DIR>/<pkg>/...`.
					if ( key === 'build-style' ) {
						return [ name, value ];
					}
					if ( key.startsWith( '/build/' ) ) {
						return [
							`${ name }/${ key.slice( '/build/'.length ) }`,
							value,
						];
					}
					return [ `${ name }/${ key }`, value ];
				} )
			),
			output: {
				...cfg.output,
				path: BUILD_DIR,
			},
			// Strip any CopyWebpackPlugin instances from the loaded config.
			// Their `to:` paths assume the package's own webpack output
			// layout (e.g. product-editor copies block.json to
			// `./build/blocks/...`). Admin's own CopyWebpackPlugin (below)
			// copies these same assets to the correct admin-relative path.
			plugins: ( cfg.plugins || [] ).filter(
				( p ) => p.constructor.name !== 'CopyPlugin'
			),
		},
	];
} );

// Make the JS compiler wait for all CSS compilers to finish so any
// CopyWebpackPlugin operations on emitted CSS see a complete set.
jsConfig.dependencies = packageCssConfigs.map( ( c ) => c.name );

module.exports = [ ...packageCssConfigs, jsConfig ];
