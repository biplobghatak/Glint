import { resolve } from "node:path"
import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
    // Stamp each build so the content script can announce which one is running.
    // An unpacked extension does NOT auto-update: without this, a stale build
    // is indistinguishable from a broken one.
    define: { __GLINT_BUILD__: JSON.stringify(new Date().toISOString()) },
  }),
  // `wxt dev` otherwise launches a throwaway Chrome profile every run, so you
  // are logged out of LinkedIn and Glint is unpaired each time — which makes
  // the extension impossible to exercise. Point it at a profile directory that
  // persists instead: sign into LinkedIn and pair once, and both survive
  // restarts. `.wxt/` is gitignored, so the profile never enters the repo.
  webExt: {
    chromiumProfile: resolve(".wxt/chrome-data"),
    keepProfileChanges: true,
    startUrls: ["https://www.linkedin.com/feed/"],
  },
  // The Side Panel API is Chrome-only. Emitting side_panel/sidePanel on other
  // targets makes WXT translate it into a Firefox sidebar_action, shipping a
  // sidebar whose background listeners never register.
  manifest: ({ browser }) => ({
    name: "Glint",
    description: "Score LinkedIn leads against your ICP as you browse.",
    action: { default_title: "Glint" },
    permissions:
      browser === "chrome"
        ? ["storage", "sidePanel", "tabs"]
        : ["storage", "tabs"],
    host_permissions: ["*://*.linkedin.com/*"],
    ...(browser === "chrome"
      ? { side_panel: { default_path: "sidepanel.html" } }
      : {}),
  }),
})
