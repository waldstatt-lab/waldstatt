import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// The Pages workflow sets SITE_URL and BASE_PATH from the repository's Pages
// settings, so the build works both as the organization site (base "/") and as
// a project site (base "/<repository>/"). Locally the defaults apply.
export default defineConfig({
  site: process.env.SITE_URL || "https://2raben.github.io",
  base: process.env.BASE_PATH || "/",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
  devToolbar: { enabled: false },
});
