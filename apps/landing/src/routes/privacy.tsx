import { createFileRoute } from "@tanstack/react-router"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env, externalLinkProps } from "#/env"

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy — scopy" }],
  }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <>
      <LandingNav />
      <main className="l-legal">
        <div className="l-wrap l-legal-wrap">
          <h1 className="l-legal-title">Privacy Policy</h1>
          <p className="l-legal-updated">Last updated: June 13, 2026</p>

          <div className="l-legal-body">
            <p>
              This policy describes how Scopy handles information when you use
              our hosted service or interact with us. If you self-host Scopy,
              your data stays in infrastructure you control — this policy
              applies mainly to the cloud offering at{" "}
              <a href={env.appUrl} {...externalLinkProps(env.appUrl)}>
                our app
              </a>
              .
            </p>

            <section>
              <h2>Information we collect</h2>
              <p>When you use Scopy cloud, we may collect:</p>
              <ul>
                <li>
                  Account information from GitHub sign-in, such as your GitHub
                  user ID, username, and email address.
                </li>
                <li>
                  Repository and pull request data needed to run reviews,
                  including code diffs, file paths, PR titles, descriptions,
                  and review comments.
                </li>
                <li>
                  Workspace and billing information, such as plan tier, usage,
                  and payment-related records processed by our payment provider.
                </li>
                <li>
                  Technical and usage data, such as logs, request metadata, and
                  product analytics used to operate and improve the service.
                </li>
              </ul>
            </section>

            <section>
              <h2>How we use information</h2>
              <p>We use collected information to:</p>
              <ul>
                <li>Authenticate you and connect your GitHub repositories.</li>
                <li>
                  Run AI-assisted code reviews and post feedback on pull
                  requests.
                </li>
                <li>Provide billing, support, and account management.</li>
                <li>Maintain security, prevent abuse, and improve Scopy.</li>
              </ul>
            </section>

            <section>
              <h2>GitHub data</h2>
              <p>
                Scopy accesses GitHub through the permissions you grant during
                installation. We only request access needed to review pull
                requests and post comments. You can revoke access at any time
                through GitHub.
              </p>
            </section>

            <section>
              <h2>AI processing</h2>
              <p>
                To generate reviews, relevant pull request content may be sent
                to AI model providers configured for your workspace. On hosted
                plans, we use providers selected to operate the service. On
                self-hosted deployments, you choose the providers and where
                data is sent.
              </p>
            </section>

            <section>
              <h2>Self-hosting</h2>
              <p>
                If you run Scopy on your own infrastructure, you are responsible
                for the data processed in that environment. The open-source
                software does not send data to us unless you explicitly connect
                it to Scopy cloud services.
              </p>
            </section>

            <section>
              <h2>Sharing and subprocessors</h2>
              <p>
                We do not sell your personal information. We share data only
                with service providers that help us run Scopy, such as hosting,
                payment, and AI inference providers, and only as needed to
                deliver the service or comply with law.
              </p>
            </section>

            <section>
              <h2>Retention</h2>
              <p>
                We retain account, billing, and review-related data for as long
                as your workspace is active and as needed for legal, security,
                and operational purposes. You can request deletion of your
                account data by contacting us.
              </p>
            </section>

            <section>
              <h2>Security</h2>
              <p>
                We use reasonable technical and organizational measures to
                protect data in transit and at rest. No method of transmission
                or storage is completely secure.
              </p>
            </section>

            <section>
              <h2>Your choices</h2>
              <p>
                Depending on where you live, you may have rights to access,
                correct, delete, or export personal data we hold about you. To
                make a request, contact us using the details below.
              </p>
            </section>

            <section>
              <h2>Changes</h2>
              <p>
                We may update this policy from time to time. When we do, we will
                revise the date at the top of this page.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Questions about this policy? Open an issue on{" "}
                <a href={env.githubUrl} {...externalLinkProps(env.githubUrl)}>
                  GitHub
                </a>{" "}
                or reach out through your workspace support channel.
              </p>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  )
}
