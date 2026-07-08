import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
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
