import { tanstackConfig } from "@tanstack/eslint-config"

export default [...tanstackConfig, { ignores: ["dist/**", "eslint.config.ts"] }]
