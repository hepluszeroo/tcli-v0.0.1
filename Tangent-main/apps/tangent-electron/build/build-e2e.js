// Webpack presence check
try {
  require.resolve('webpack');
} catch (error) {
  console.error('\n❌ ERROR: webpack is missing!\n');
  console.error('This is typically caused by one of the following:');
  console.error('1. In Docker: pnpm install was run without -w --prod=false flags');
  console.error('2. In local dev: webpack is not installed as a devDependency');
  console.error('\nTo fix in Docker: modify Dockerfile.playwright to include:');
  console.error('  pnpm install -w --prod=false --frozen-lockfile\n');
  console.error('To fix locally: npm install -D webpack webpack-cli\n');
  process.exit(1);
}

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');

// Import the index module directly
const buildIndex = require('./index');

// Build the e2e test stub
function buildE2eStub() {
  console.log('Building E2E Test Stub with Webpack...');

  // Log environment settings for debugging
  console.log(`Environment: NODE_ENV=${process.env.NODE_ENV}, E2E_TEST=${process.env.E2E_TEST}`);

  return new Promise((resolve, reject) => {
    const stubConfig = require('../src/testing/e2e_stub/webpack.config');

    // Ensure mode is always valid
    const validModes = ['development', 'production', 'none'];
    if (!validModes.includes(stubConfig.mode)) {
      console.log(`Overriding invalid webpack mode "${stubConfig.mode}" with "development"`);
      stubConfig.mode = 'development';
    }

    // ---- inject shared aliases for the E2E-stub build -----------------
    // Ensure we have proper aliases for typewriter modules
    const aliases = require(path.resolve(__dirname, '../webpack.aliases.js'));
    stubConfig.resolve = stubConfig.resolve || {};
    stubConfig.resolve.alias = { ...(stubConfig.resolve.alias || {}), ...aliases };
    // -------------------------------------------------------------------

    console.log('Using webpack aliases:', JSON.stringify(stubConfig.resolve.alias, null, 2));

    const stubCompiler = webpack(stubConfig);

    stubCompiler.run((err, stats) => {
      if (logWebpackErrors(err, stats)) {
        console.error('webpack failed to build E2E stub');
        reject();
        throw 'Webpack failed to build E2E stub';
      } else {
        console.log('E2E stub built successfully');
        resolve();
      }

      stubCompiler.close(closeErr => {
        if (closeErr) {
          console.error('webpack failed to close');
          console.log(closeErr);
        }
      });
    });
  });
}

function logWebpackErrors(err, stats) {
  if (err) {
    console.error(err.stack || err);
    if (err.details) {
      console.error(err.details);
    }
    return 2;
  }

  const info = stats.toJson();

  let result = 0;
  if (stats.hasErrors()) {
    console.log(info.errors.length, 'Errors');
    for (let err of info.errors) {
      console.log(err.moduleName, err.loc);
      console.log(err.message);
    }
    result = 1;
  }

  if (stats.hasWarnings()) {
    console.log(info.warnings.length, 'Warnings');
    for (let warning of info.warnings) {
      console.log(warning.moduleName, warning.loc);
      console.log(warning.message);
    }
  }
  return result;
}

// Build the preload script
function buildPreload() {
  console.log('Building Preload with Webpack...');
  return new Promise((resolve, reject) => {
    try {
      const preloadConfig = require('../src/preload/webpack.config');
      const preloadCompiler = webpack(preloadConfig);

      preloadCompiler.run((err, stats) => {
        if (logWebpackErrors(err, stats)) {
          console.error('webpack failed to build preload');
          reject();
          return;
        } else {
          console.log('Preload built successfully');
          resolve();
        }

        preloadCompiler.close(closeErr => {
          if (closeErr) {
            console.error('webpack failed to close');
            console.log(closeErr);
          }
        });
      });
    } catch (err) {
      console.error('Error loading preload webpack config:', err);
      reject(err);
    }
  });
}

async function buildE2eTest() {
  console.log('Building preload script first...');

  // First build the preload since we need it
  try {
    await buildPreload();
  } catch (err) {
    console.error('Failed to build preload:', err);
    console.log('Will attempt to continue if preload.js already exists');
  }

  // Then build our stub
  await buildE2eStub();

  // Verify that both files exist
  const bundlePath = path.resolve(path.join(__dirname, '../__build/bundle'));
  const mainPath = path.join(bundlePath, 'main.js');
  const preloadPath = path.join(bundlePath, 'preload.js');

  console.log('Verifying build artifacts:');
  if (fs.existsSync(mainPath)) {
    console.log(`✅ main.js exists at ${mainPath}`);
  } else {
    console.error(`❌ main.js not found at ${mainPath}`);
    throw new Error('E2E build failed: main.js not found');
  }

  if (fs.existsSync(preloadPath)) {
    console.log(`✅ preload.js exists at ${preloadPath}`);
  } else {
    console.error(`❌ preload.js not found at ${preloadPath}`);
    throw new Error('E2E build failed: preload.js not found');
  }

  console.log('E2E test build complete!');
}

// Execute if run directly
if (require.main === module) {
  buildE2eTest().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

module.exports = {
  buildE2eStub,
  buildPreload,
  buildE2eTest
};