export const githubConnectionErrorCodes = {
  invalid_authorization_callback: "invalid_authorization_callback",
  invalid_installation_callback: "invalid_installation_callback",
  installation_not_accessible: "installation_not_accessible",
  personal_account_already_connected: "personal_account_already_connected",
  workspace_not_found: "workspace_not_found",
  connect_failed: "connect_failed",
  authorization_denied: "authorization_denied",
} as const

export type GitHubConnectionErrorCode =
  (typeof githubConnectionErrorCodes)[keyof typeof githubConnectionErrorCodes]

const githubConnectionErrorMessages: Record<GitHubConnectionErrorCode, string> =
  {
    invalid_authorization_callback:
      "Invalid GitHub authorization. Please try connecting again.",
    invalid_installation_callback:
      "Invalid GitHub installation callback. Please try connecting again.",
    installation_not_accessible:
      "This GitHub installation is not accessible with your account. Authorize the account that owns the installation and try again.",
    personal_account_already_connected:
      "This personal GitHub account is already connected to another user.",
    workspace_not_found:
      "Organization not found. Try connecting it again from the dashboard.",
    connect_failed: "Failed to connect GitHub. Please try again.",
    authorization_denied:
      "GitHub authorization was cancelled. Connect again when you're ready.",
  }

export function getGitHubConnectionErrorMessage(code: string) {
  if (code in githubConnectionErrorMessages) {
    return githubConnectionErrorMessages[code as GitHubConnectionErrorCode]
  }

  return "Something went wrong while connecting GitHub. Please try again."
}
