import { App, Octokit } from "octokit";
import { Webhooks } from "@octokit/webhooks";
import { env } from "../../env";

type GitHubAccount = {
  id: number;
  login: string;
  type: string;
  avatar_url?: string | null;
};

export type GitHubInstallation = {
  id: number;
  account: GitHubAccount | null;
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  suspended_at?: string | null;
};

export type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  private: boolean;
  default_branch: string | null;
  html_url: string;
  archived: boolean;
};

type GitHubConfig = {
  appId: string;
  appSlug: string;
  privateKey: string;
  webhookSecret: string;
};

type GitHubUserAuthConfig = {
  clientId: string;
  clientSecret: string;
};

const normalizePrivateKey = (privateKey: string) =>
  privateKey.replace(/\\n/g, "\n");

export const getGitHubConfig = (): GitHubConfig | null => {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_SLUG ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_WEBHOOK_SECRET
  ) {
    return null;
  }

  return {
    appId: env.GITHUB_APP_ID,
    appSlug: env.GITHUB_APP_SLUG,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
  };
};

export const requireGitHubConfig = () => {
  const config = getGitHubConfig();

  if (!config) {
    throw new Error("GitHub App is not configured");
  }

  return config;
};

export const requireGitHubUserAuthConfig = (): GitHubUserAuthConfig => {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    throw new Error("GitHub App user authorization is not configured");
  }

  return {
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  };
};

export const createGitHubApp = () => {
  const config = requireGitHubConfig();

  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
  });
};

export const createGitHubWebhooks = () => {
  const config = requireGitHubConfig();

  return new Webhooks({
    secret: config.webhookSecret,
  });
};

export const getGitHubInstallUrl = (state: string) => {
  const config = requireGitHubConfig();
  requireGitHubUserAuthConfig();
  const params = new URLSearchParams({
    state,
  });

  return `https://github.com/apps/${config.appSlug}/installations/new?${params.toString()}`;
};

const getGitHubUserAuthorizationCallbackUrl = () =>
  new URL("/github/authorization", env.FRONTEND_URL).toString();

export const getGitHubUserAuthorizationUrl = (state: string) => {
  const config = requireGitHubUserAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getGitHubUserAuthorizationCallbackUrl(),
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

export const verifyGitHubInstallationForUser = async (
  installationId: string,
  code: string,
) => {
  const config = requireGitHubUserAuthConfig();
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
      redirect_uri: getGitHubUserAuthorizationCallbackUrl(),
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange GitHub user authorization code");
  }

  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
  };

  if (!payload.access_token) {
    throw new Error(payload.error ?? "GitHub user authorization failed");
  }

  const octokit = new Octokit({
    auth: payload.access_token,
  });

  const installations = await octokit.paginate("GET /user/installations", {
    per_page: 100,
  });

  if (
    !installations.some(
      (installation) => String(installation.id) === installationId,
    )
  ) {
    throw new Error("GitHub installation is not accessible to the user");
  }
};

export const getGitHubInstallation = async (installationId: string) => {
  const app = createGitHubApp();
  const response = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    {
      installation_id: Number(installationId),
    },
  );

  return response.data as GitHubInstallation;
};

export const createGitHubInstallationAccessToken = async (
  installationId: string,
) => {
  const app = createGitHubApp();
  const response = await app.octokit.request(
    "POST /app/installations/{installation_id}/access_tokens",
    {
      installation_id: Number(installationId),
    },
  );

  return response.data.token;
};

export const listGitHubInstallationRepositories = async (
  installationId: string,
) => {
  const app = createGitHubApp();
  const installationOctokit = await app.getInstallationOctokit(
    Number(installationId),
  );

  const repositories = await installationOctokit.paginate(
    "GET /installation/repositories",
    {
      per_page: 100,
    },
    (response) => response.data,
  );

  return repositories as GitHubRepository[];
};
