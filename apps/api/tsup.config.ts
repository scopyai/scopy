import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  external: [
    "@qdrant/js-client-rest",
    "tree-sitter",
    "tree-sitter-go",
    "tree-sitter-java",
    "tree-sitter-javascript",
    "tree-sitter-python",
    "tree-sitter-rust",
    "tree-sitter-typescript",
  ],
  noExternal: [
    "tools",
    "@workspace/billing",
    "@hatchet-dev/typescript-sdk/v1",
  ],
  esbuildPlugins: [
    {
      name: "hatchet-v1-entry",
      setup(build) {
        build.onResolve(
          { filter: /^@hatchet-dev\/typescript-sdk\/v1$/ },
          () => ({
            path: "@hatchet-dev/typescript-sdk/v1/index.js",
            external: true,
          })
        )
      },
    },
  ],
})
