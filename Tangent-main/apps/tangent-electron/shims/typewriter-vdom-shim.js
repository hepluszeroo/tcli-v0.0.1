// Lightweight shim that replaces the optional
// `typewriter-editor/dist/rendering/vdom` module during tests and builds.
// It exports an empty object so that `require()` succeeds without dragging
// the heavy virtual-DOM implementation (which has native bindings) into the
// bundle.

export const mockVDom = {};
export default mockVDom;

// Add the 'h' function that's imported by typewriterTypes.ts
export function h() {
  return { type: 'div', props: {}, children: [] };
}
