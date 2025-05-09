// Central registry of Webpack aliases used by all build targets (main
// process, preload bundle and the E2E-stub entry).  Keeping them in a single
// file guarantees that a dependency shimmed for one bundle does not slip
// through in another bundle and avoids repetitive, drifting config edits.

const path = require('path');

// Base directory of the electron app – every path below is resolved from
// this file’s location so the aliases work regardless of the current
// working directory of the invoking script.
const rootDir = __dirname;

// Helper – resolve relative to the electron-app root.
const r = (p) => path.resolve(rootDir, p);

module.exports = {
  // Replace the entire heavy `typewriter-editor` package with a lightweight
  // no-op shim.  This covers the common default import:
  //   import Editor from 'typewriter-editor'
  'typewriter-editor': r('shims/typewriter-editor-shim.js'),

  // The deepest path that keeps blowing up the build – some files import the
  // VDOM helper directly.  Point it to a trivial object so Webpack/TSC are
  // satisfied.
  'typewriter-editor/dist/rendering/vdom': r('shims/typewriter-vdom-shim.js'),
  'typewriter-editor/dist/rendering/vdom.js': r('shims/typewriter-vdom-shim.js'),

  // The heavy query parser library is not required for the E2E Codex tests –
  // map it to an empty stub so Webpack does not attempt to bundle the real
  // (native) implementation.
  '@such-n-such/tangent-query-parser': r('shims/tangent-query-parser-shim.js'),
};
