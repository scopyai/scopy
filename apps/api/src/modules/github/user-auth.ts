import { Octokit } from "octokit"
import { apiEnv as env } from "../../env"
import { requireGitHubConfig } from "./service"

const requireGitHubUserAuthConfig = () => {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    throw new Error("GitHub App user authorization is not configured")
  }

  return {
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  }
}

const callbackUrl = () => new URL("/github/authorization", env.BETTER_AUTH_URL).toString()

export const getGitHubInstallUrl = (state: string) => {
  const config = requireGitHubConfig()
  requireGitHubUserAuthConfig()
  return `https://github.com/apps/${config.appSlug}/installations/new?${new URLSearchParams({ state })}`
}

export const getGitHubUserAuthorizationUrl = (state: string) => {
  const config = requireGitHubUserAuthConfig()
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(),
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export const verifyGitHubInstallationForUser = async (installationId: string, code: string) => {
  const config = requireGitHubUserAuthConfig()
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: callbackUrl(),
    }),
  })
  if (!response.ok) throw new Error("Failed to exchange GitHub user authorization code")

  const payload = (await response.json()) as {
    access_token?: string
    error?: string
  }
  if (!payload.access_token) {
    throw new Error(payload.error ?? "GitHub user authorization failed")
  }

  const octokit = new Octokit({ auth: payload.access_token })
  const installations = await octokit.paginate("GET /user/installations", {
    per_page: 100,
  })
  if (!installations.some((installation) => String(installation.id) === installationId)) {
    throw new Error("GitHub installation is not accessible to the user")
  }
}
