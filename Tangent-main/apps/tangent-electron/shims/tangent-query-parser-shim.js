// Stub replacement for the '@such-n-such/tangent-query-parser' package when
// running the E2E Electron bundle.  The real implementation is only required
// by workspace-search features that are not exercised in the Playwright
// Codex integration tests, so an empty no-op module keeps the bundle size
// small and avoids optional dependencies that may not compile in CI.

module.exports = {
  parse: () => ({}),
  stringify: () => '',
};
