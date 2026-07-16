import { App } from "octokit";
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
};

const normalizePrivateKey = (privateKey: string) =>
  privateKey.replace(/\\n/g, "\n");

export const getGitHubConfig = (): GitHubConfig | null => {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_SLUG ||
    !env.GITHUB_APP_PRIVATE_KEY
  ) {
    return null;
  }

  return {
    appId: env.GITHUB_APP_ID,
    appSlug: env.GITHUB_APP_SLUG,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  };
};

export const requireGitHubConfig = () => {
  const config = getGitHubConfig();

  if (!config) {
    throw new Error("GitHub App is not configured");
  }

  return config;
};

export const createGitHubApp = () => {
  const config = requireGitHubConfig();

  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
  });
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
