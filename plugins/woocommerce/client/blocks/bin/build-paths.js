/**
 * External dependencies
 */
const path = require( 'path' );

// Blocks' webpack output is written directly into the WooCommerce plugin's
// `assets/client/blocks/` directory so PHP can enqueue files from their final
// location without an intermediate copy step. All webpack configs and
// post-processing plugins in this package go through this constant.
const BUILD_DIR = path.resolve(
	__dirname,
	'../../../assets/client/blocks'
);

// Repo root (handy for shared node_modules cache paths).
const ROOT_DIR = path.resolve( __dirname, '../../../../../' );

module.exports = {
	BUILD_DIR,
	ROOT_DIR,
};
