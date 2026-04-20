import { env } from "@/env";
import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins"; 

export const authClient = createAuthClient({
    baseURL: env.API_BASE_URL,
    plugins: [
        magicLinkClient() 
    ]
});
