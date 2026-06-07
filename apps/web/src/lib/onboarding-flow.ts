const OVERVIEW_SEEN_KEY = "onboarding-overview-seen"

export function hasSeenOnboardingOverview() {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(OVERVIEW_SEEN_KEY) === "1"
}

export function markOnboardingOverviewSeen() {
  sessionStorage.setItem(OVERVIEW_SEEN_KEY, "1")
}

export function getOnboardingRepositoriesEntryPath() {
  return hasSeenOnboardingOverview()
    ? "/onboarding/repositories"
    : "/onboarding/overview"
}
