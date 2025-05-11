// Minimal Svelte configuration file for webpack builds
const SveltePreprocess = require('svelte-preprocess');

module.exports = {
    preprocess: SveltePreprocess({
        scss: true
    })
};