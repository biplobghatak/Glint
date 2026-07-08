import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Glint",
    description: "Score LinkedIn leads against your ICP as you browse.",
    action: { default_title: "Glint" },
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: ["*://*.linkedin.com/*"],
    side_panel: { default_path: "sidepanel.html" },
  },
})
