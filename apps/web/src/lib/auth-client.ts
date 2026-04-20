import { env } from "@/env";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
    baseURL: env.VITE_API_BASE_URL,
    plugins: [
        magicLinkClient(),
    ],
});
