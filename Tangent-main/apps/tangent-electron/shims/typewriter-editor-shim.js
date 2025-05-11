// Root-level shim for the entire `typewriter-editor` package so that any
// import like `import Editor from 'typewriter-editor'` resolves during
// compilation without bundling the real dependency (which is large and not
// needed by the Codex integration tests).

export const Editor = {};
export default Editor;
