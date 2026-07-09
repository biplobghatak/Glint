// Injected by Vite's `define` in wxt.config.ts. Lets the content script
// announce which build is actually running in the page, so a stale unpacked
// extension is obvious instead of looking like a code bug.
declare const __GLINT_BUILD__: string
