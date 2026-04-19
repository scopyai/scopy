import 'dotenv/config'
import { z } from 'zod'
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(currentDir, "../../../.env");

config({ path: rootEnvPath, quiet: true });

export const env = z.object({
    PORT: z.number().default(3001),
}).parse(process.env)
