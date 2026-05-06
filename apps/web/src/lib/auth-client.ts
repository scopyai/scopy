import { env } from "@/env";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
    baseURL: env.VITE_API_BASE_URL,
});
