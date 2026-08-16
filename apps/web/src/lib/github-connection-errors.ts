const githubConnectionErrorMessages = {
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
} as const

type GitHubConnectionErrorCode = keyof typeof githubConnectionErrorMessages

export function getGitHubConnectionErrorMessage(code: string) {
  if (Object.hasOwn(githubConnectionErrorMessages, code)) {
    return githubConnectionErrorMessages[code as GitHubConnectionErrorCode]
  }

  return "Something went wrong while connecting GitHub. Please try again."
}
