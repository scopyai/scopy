import { defineConfig } from "vite"
// import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { cloudflare } from "@cloudflare/vite-plugin"

import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  } as import("vite").UserConfig["resolve"],
  plugins: [
    // devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
