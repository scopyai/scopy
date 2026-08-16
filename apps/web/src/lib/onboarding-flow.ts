const WELCOME_SEEN_KEY = "onboarding-welcome-seen"
const OVERVIEW_SEEN_KEY = "onboarding-overview-seen"
const WORKSPACE_ID_KEY = "onboarding-workspace-id"

const readSession = (key: string) =>
  typeof window === "undefined" ? null : sessionStorage.getItem(key)
const markSeen = (key: string) => sessionStorage.setItem(key, "1")

export const hasSeenOnboardingWelcome = () =>
  readSession(WELCOME_SEEN_KEY) === "1"

export const markOnboardingWelcomeSeen = () => markSeen(WELCOME_SEEN_KEY)

export const hasSeenOnboardingOverview = () =>
  readSession(OVERVIEW_SEEN_KEY) === "1"

export const markOnboardingOverviewSeen = () => markSeen(OVERVIEW_SEEN_KEY)

export const getOnboardingWorkspaceId = () => readSession(WORKSPACE_ID_KEY)

export const setOnboardingWorkspaceId = (workspaceId: string) =>
  sessionStorage.setItem(WORKSPACE_ID_KEY, workspaceId)

export const clearOnboardingWorkspaceId = () =>
  sessionStorage.removeItem(WORKSPACE_ID_KEY)

export const getOnboardingConnectEntryPath = () =>
  hasSeenOnboardingWelcome()
    ? "/onboarding/connect"
    : "/onboarding/welcome"

export const getOnboardingRepositoriesEntryPath = () =>
  hasSeenOnboardingOverview()
    ? "/onboarding/repositories"
    : "/onboarding/overview"
