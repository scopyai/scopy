import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ArrowRightIcon } from "lucide-react"
import { markOnboardingWelcomeSeen } from "@/lib/onboarding-flow"

export const Route = createFileRoute("/_app/onboarding/welcome")({
  component: OnboardingWelcomePage,
})

function OnboardingWelcomePage() {
  const navigate = useNavigate()

  const handleContinue = () => {
    markOnboardingWelcomeSeen()
    navigate({ to: "/onboarding/connect" })
  }

  return (
    <div className="flex h-full items-center justify-center px-6s py-10">
      <div className="flex w-full max-w-md flex-col gap-10">
        <div className="flex flex-col gap-5">
          <p className="text-base leading-relaxed text-foreground">
            Hi, I&apos;m happy to see you here.
          </p>
          <p className="text-base leading-relaxed text-muted-foreground">
            I started building Scopy as an open source tool that everyone can benefit from.
          </p>
          <p className="text-base leading-relaxed text-muted-foreground">
             I'm building it because I think that
            code review tools should earn their users' trust the same way humans do – by being good at their job.
          </p>
          <p className="text-base leading-relaxed text-muted-foreground">
            You can always text me if you have any questions.
          </p>
          <p className="text-base leading-relaxed text-muted-foreground">
            Thanks for giving Scopy a try.
          </p>
          <p className="pt-1 text-base text-muted-foreground">– Matt, founder</p>
        </div>

        <div className="flex justify-start">
          <Button onClick={handleContinue}>
            Continue
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  )
}
