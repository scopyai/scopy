const WELCOME_SEEN_KEY = "onboarding-welcome-seen"
const OVERVIEW_SEEN_KEY = "onboarding-overview-seen"

export function hasSeenOnboardingWelcome() {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(WELCOME_SEEN_KEY) === "1"
}

export function markOnboardingWelcomeSeen() {
  sessionStorage.setItem(WELCOME_SEEN_KEY, "1")
}

export function hasSeenOnboardingOverview() {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(OVERVIEW_SEEN_KEY) === "1"
}

export function markOnboardingOverviewSeen() {
  sessionStorage.setItem(OVERVIEW_SEEN_KEY, "1")
}

export function getOnboardingConnectEntryPath() {
  return hasSeenOnboardingWelcome()
    ? "/onboarding/connect"
    : "/onboarding/welcome"
}

export function getOnboardingRepositoriesEntryPath() {
  return hasSeenOnboardingOverview()
    ? "/onboarding/repositories"
    : "/onboarding/overview"
}
