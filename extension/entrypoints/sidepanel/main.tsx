import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import "./style.css"
import { DEFAULT_THEME, applyTheme, getTheme } from "@/lib/theme"

// Paint light immediately, then correct from storage. Awaiting the read before
// the first render would show an unstyled flash on every panel remount, and
// Chrome remounts the panel every time it re-enables it for a LinkedIn tab.
applyTheme(DEFAULT_THEME)
getTheme().then(applyTheme)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
