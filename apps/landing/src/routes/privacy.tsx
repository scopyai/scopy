import { createFileRoute } from "@tanstack/react-router"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env, externalLinkProps } from "#/env"

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Terms of Service & Privacy Policy — Scopy" }],
  }),
  component: LegalPage,
})

function LegalPage() {
  return (
    <>
      <LandingNav />
      <main className="l-legal">
        <div className="l-wrap l-legal-wrap">
          <h1 className="l-legal-title">Terms of Service &amp; Privacy Policy</h1>
          <p className="l-legal-updated">Last updated: June 14, 2026</p>

          <div className="l-legal-body">
            <p>
              These Terms of Service and Privacy Policy (together, this
              &ldquo;Agreement&rdquo;) govern your use of the Scopy hosted
              service at{" "}
              <a href={env.appUrl} {...externalLinkProps(env.appUrl)}>
                {env.appUrl}
              </a>{" "}
              and related websites, APIs, and support channels operated by
              Scopy through scopy.dev (collectively, the &ldquo;Service&rdquo;).
              Scopy is an open-source AI code review product. If you self-host
              the Scopy software, your deployment is outside this Agreement
              unless you separately connect it to Scopy cloud services.
            </p>

            <section>
              <h2>Table of contents</h2>
              <nav aria-label="Table of contents">
                <ol className="l-legal-toc">
                  <li>
                    <a href="#terms">Part I — Terms of Service</a>
                  </li>
                  <li>
                    <a href="#privacy">Part II — Privacy Policy</a>
                  </li>
                </ol>
              </nav>
            </section>

            <div id="terms" className="l-legal-part">
              <h2 className="l-legal-part-title">Part I — Terms of Service</h2>

              <section>
                <h2>1. Acceptance of these Terms</h2>
                <p>
                  By creating an account, connecting a GitHub workspace,
                  purchasing a paid plan, or otherwise accessing or using the
                  Service, you agree to this Agreement. If you use the Service
                  on behalf of a company or other organization, you represent
                  that you have authority to bind that organization, and
                  &ldquo;you&rdquo; refers to that organization.
                </p>
                <p>
                  If you do not agree, do not use the Service. Your continued
                  use after we post changes constitutes acceptance of the
                  updated Agreement, except where applicable law requires
                  additional consent.
                </p>
              </section>

              <section>
                <h2>2. The Service</h2>
                <p>
                  Scopy provides AI-assisted code review for software
                  repositories connected through GitHub. Depending on your
                  configuration, the Service may:
                </p>
                <ul>
                  <li>
                    Receive GitHub webhooks and repository metadata for
                    connected workspaces.
                  </li>
                  <li>
                    Analyze pull request diffs, related repository context, and
                    review configuration.
                  </li>
                  <li>
                    Generate review findings and post comments or reviews back
                    to GitHub.
                  </li>
                  <li>
                    Provide workspace management, billing, usage analytics, and
                    support features through the Scopy web application.
                  </li>
                </ul>
                <p>
                  The Service also includes the open-source Scopy software
                  published on{" "}
                  <a href={env.githubUrl} {...externalLinkProps(env.githubUrl)}>
                    GitHub
                  </a>
                  , which you may run on your own infrastructure under the
                  license provided in that repository. Self-hosted deployments
                  are not operated by us and are not covered by the service
                  commitments in this Agreement.
                </p>
              </section>

              <section>
                <h2>3. Eligibility</h2>
                <p>
                  You must be at least 18 years old, or the age of majority in
                  your jurisdiction if higher, to use the Service. The Service
                  is intended for software development and business use. You may
                  not use the Service if you are barred from doing so under
                  applicable law or if we have previously suspended or terminated
                  your account for violation of this Agreement.
                </p>
              </section>

              <section>
                <h2>4. Accounts and authentication</h2>
                <p>
                  To use the hosted Service, you must create an account. We
                  currently support sign-in through Google OAuth. You are
                  responsible for maintaining the security of the accounts and
                  credentials you use to access the Service and for all
                  activity that occurs under your account.
                </p>
                <p>
                  You must provide accurate account information and keep it
                  current. Notify us promptly at{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>{" "}
                  if you believe your account has been compromised.
                </p>
              </section>

              <section>
                <h2>5. GitHub integration</h2>
                <p>
                  Connecting a GitHub user or organization requires installing
                  and authorizing the Scopy GitHub App with the permissions
                  needed to list repositories, read pull request content, and
                  post review feedback. You represent that you have the right to
                  connect each workspace and each repository you enable for
                  review.
                </p>
                <p>
                  Your use of GitHub is also governed by GitHub&apos;s terms
                  and policies. You may revoke Scopy&apos;s access at any time
                  through GitHub settings, but doing so may prevent the Service
                  from functioning for that workspace.
                </p>
              </section>

              <section>
                <h2>6. Acceptable use</h2>
                <p>You agree not to:</p>
                <ul>
                  <li>
                    Use the Service in violation of law, third-party rights, or
                    export control rules.
                  </li>
                  <li>
                    Upload, connect, or process content you do not have the
                    right to use, including proprietary code or personal data
                    you are not authorized to share with us or our providers.
                  </li>
                  <li>
                    Attempt to probe, scan, disrupt, overload, or gain
                    unauthorized access to the Service or related systems.
                  </li>
                  <li>
                    Reverse engineer, scrape, or misuse the Service except to
                    the extent such restriction is prohibited by applicable law
                    or expressly permitted by our open-source license for the
                    self-hosted software.
                  </li>
                  <li>
                    Resell, sublicense, or provide the hosted Service to third
                    parties except as part of your organization&apos;s normal
                    internal development workflow.
                  </li>
                  <li>
                    Use the Service to develop or distribute malware, spam, or
                    other harmful code or content.
                  </li>
                </ul>
                <p>
                  We may investigate and suspend or terminate access if we
                  reasonably believe you have violated this section or pose a
                  security, legal, or operational risk.
                </p>
              </section>

              <section>
                <h2>7. Your content and code</h2>
                <p>
                  You retain ownership of your repositories, code, pull
                  requests, and other content you connect to the Service
                  (&ldquo;Customer Content&rdquo;). You grant us a limited,
                  worldwide, non-exclusive license to host, copy, process,
                  transmit, display, and otherwise use Customer Content only as
                  necessary to provide, secure, maintain, and improve the
                  Service, comply with law, and enforce this Agreement.
                </p>
                <p>
                  You are solely responsible for Customer Content and for
                  ensuring that your use of the Service, including sending code
                  and repository data to AI providers, complies with your
                  internal policies, customer contracts, employment agreements,
                  and applicable law.
                </p>
              </section>

              <section>
                <h2>8. AI-generated output</h2>
                <p>
                  Scopy uses large language models and related tools to
                  generate review comments, summaries, and findings. AI output
                  may be inaccurate, incomplete, or unsuitable for your
                  environment. You must review AI-generated output before relying
                  on it. The Service does not replace human code review,
                  security review, legal review, or your own release processes.
                </p>
                <p>
                  We do not claim ownership of AI-generated review output posted
                  to your repositories, but we do not guarantee that such output
                  is unique, non-infringing, or fit for any particular purpose.
                </p>
              </section>

              <section>
                <h2>9. Plans, billing, and payment</h2>
                <h3>Free and self-hosted use</h3>
                <p>
                  You may use the open-source Scopy software without charge on
                  infrastructure you control. The hosted Service may offer free
                  workspace access subject to usage limits we publish from time
                  to time.
                </p>
                <h3>Paid plans</h3>
                <p>
                  Paid hosted plans, such as Premium and Ultra, are billed on a
                  recurring monthly basis in U.S. dollars unless otherwise
                  stated at checkout. Prices, included compute allowances, and
                  plan features are described on our website and in the
                  application. We may change plan features or pricing for future
                  billing periods with reasonable notice.
                </p>
                <h3>Payment processing</h3>
                <p>
                  Payments are processed by Creem or another payment provider we
                  designate. By subscribing, you authorize us and our payment
                  provider to charge your selected payment method for recurring
                  fees and applicable taxes. You are responsible for all
                  applicable taxes except those based on our net income.
                </p>
                <h3>Renewals, upgrades, downgrades, and cancellation</h3>
                <p>
                  Subscriptions renew automatically until canceled. Workspace
                  owners may upgrade, downgrade, or cancel through the billing
                  portal or by contacting support. Unless required by law or
                  stated otherwise at purchase, fees are non-refundable and
                  there are no prorated refunds for partial billing periods.
                  Downgrades and cancellations generally take effect at the end
                  of the current paid period.
                </p>
                <h3>Compute credits and usage</h3>
                <p>
                  Paid plans include a monthly compute allowance measured in
                  credits that are consumed by review and related processing. If
                  you exhaust your allowance before the billing period resets,
                  review activity may be paused or limited until the next reset
                  or until you upgrade. Unused monthly credits do not roll over
                  unless we expressly state otherwise.
                </p>
              </section>

              <section>
                <h2>10. Service changes and availability</h2>
                <p>
                  We may modify, suspend, or discontinue any part of the Service
                  at any time. We strive to keep the Service available, but we
                  do not guarantee uninterrupted or error-free operation.
                  Maintenance, provider outages, GitHub incidents, model
                  provider failures, and events outside our reasonable control
                  may affect availability.
                </p>
                <p>
                  We may impose reasonable technical limits, including API,
                  webhook, repository, and concurrency limits, to protect the
                  Service.
                </p>
              </section>

              <section>
                <h2>11. Suspension and termination</h2>
                <p>
                  You may stop using the Service at any time and may request
                  account deletion by contacting{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>.
                  We may suspend or terminate your access immediately if you
                  breach this Agreement, fail to pay amounts due, create risk
                  for us or other users, or if we discontinue the Service.
                </p>
                <p>
                  Upon termination, your right to use the hosted Service ends.
                  Sections that by their nature should survive termination will
                  survive, including those relating to ownership, disclaimers,
                  limitations of liability, indemnity, and dispute resolution.
                </p>
              </section>

              <section>
                <h2>12. Open-source software</h2>
                <p>
                  Portions of Scopy are made available as open-source software.
                  Your use of that software is governed by the license in the
                  applicable source repository, not by the commercial terms in
                  this Agreement, except to the extent you use our hosted
                  Service or other paid offerings.
                </p>
              </section>

              <section>
                <h2>13. Disclaimers</h2>
                <p>
                  THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
                  AVAILABLE.&rdquo; TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE
                  DISCLAIM ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, OR
                  STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY,
                  FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
                  WE DO NOT WARRANT THAT THE SERVICE WILL BE SECURE, ERROR
                  FREE, OR THAT AI-GENERATED OUTPUT WILL BE ACCURATE OR
                  COMPLETE.
                </p>
                <p>
                  Some jurisdictions do not allow certain warranty exclusions.
                  In those jurisdictions, our warranties are limited to the
                  minimum extent required by law.
                </p>
              </section>

              <section>
                <h2>14. Limitation of liability</h2>
                <p>
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, SCOPY AND ITS
                  OPERATORS, CONTRIBUTORS, SUPPLIERS, AND PARTNERS WILL NOT BE
                  LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
                  EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
                  REVENUE, DATA, GOODWILL, OR BUSINESS INTERRUPTION, ARISING OUT
                  OF OR RELATED TO THE SERVICE OR THIS AGREEMENT, EVEN IF WE
                  HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
                </p>
                <p>
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY
                  FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THE SERVICE OR
                  THIS AGREEMENT IN ANY 12-MONTH PERIOD WILL NOT EXCEED THE
                  GREATER OF (A) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THAT
                  12-MONTH PERIOD OR (B) USD $100.
                </p>
                <p>
                  Nothing in this Agreement limits liability that cannot be
                  limited under applicable law, including liability for fraud
                  or intentional misconduct.
                </p>
              </section>

              <section>
                <h2>15. Indemnification</h2>
                <p>
                  You will defend, indemnify, and hold harmless Scopy and its
                  operators from and against claims, damages, losses, and
                  expenses arising out of your Customer Content, your use of the
                  Service, your violation of this Agreement, or your violation
                  of third-party rights, including intellectual property,
                  privacy, or contractual rights.
                </p>
              </section>

              <section>
                <h2>16. Governing law and disputes</h2>
                <p>
                  This Agreement is governed by the laws applicable where
                  Scopy is operated, without regard to conflict-of-law rules,
                  except that mandatory consumer protection laws in your country
                  of residence may apply where they cannot be waived.
                </p>
                <p>
                  Before filing a claim, you agree to contact us at{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>{" "}
                  and attempt to resolve the dispute informally within 30 days.
                  If informal resolution fails, disputes will be brought in the
                  courts or tribunals with jurisdiction over Scopy&apos;s
                  operator, unless applicable law requires a different forum.
                </p>
              </section>

              <section>
                <h2>17. Changes to these Terms</h2>
                <p>
                  We may update these Terms from time to time. If we make
                  material changes, we will provide notice by posting the
                  updated Agreement, updating the date above, and, where
                  appropriate, notifying account holders by email or in-product
                  notice. Material changes take effect no earlier than the date
                  posted unless required sooner by law.
                </p>
              </section>

              <section>
                <h2>18. Contact</h2>
                <p>
                  Questions about these Terms? Email{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>{" "}
                  or open an issue on{" "}
                  <a href={env.githubUrl} {...externalLinkProps(env.githubUrl)}>
                    GitHub
                  </a>
                  .
                </p>
              </section>
            </div>

            <div id="privacy" className="l-legal-part">
              <h2 className="l-legal-part-title">Part II — Privacy Policy</h2>

              <section>
                <h2>1. Scope and roles</h2>
                <p>
                  This Privacy Policy explains how Scopy collects, uses,
                  shares, and protects personal information when you use the
                  hosted Service, visit our websites, contact support, or
                  otherwise interact with us online.
                </p>
                <p>
                  For purposes of applicable privacy law, Scopy is the data
                  controller for personal information processed through the
                  hosted Service. When you connect organization repositories,
                  you and your organization may also have independent obligations
                  regarding code, contributor information, and repository
                  metadata in your GitHub account.
                </p>
                <p>
                  This Privacy Policy does not apply to self-hosted Scopy
                  deployments you operate yourself, except where those
                  deployments are explicitly connected to Scopy cloud services.
                </p>
              </section>

              <section>
                <h2>2. Information we collect</h2>
                <p>
                  We collect information in three broad ways: information you
                  provide, information generated by your use of the Service, and
                  information from third-party services you connect.
                </p>

                <h3>Account and identity information</h3>
                <ul>
                  <li>
                    Name, email address, profile image, and email verification
                    status from your sign-in provider, such as Google.
                  </li>
                  <li>
                    Account identifiers, onboarding status, and workspace
                    membership records.
                  </li>
                  <li>
                    Session information, including session tokens, IP address,
                    browser or client user agent, and sign-in timestamps.
                  </li>
                  <li>
                    OAuth account identifiers and tokens needed to maintain your
                    authenticated session.
                  </li>
                </ul>

                <h3>GitHub and workspace information</h3>
                <ul>
                  <li>
                    GitHub installation, account, and organization identifiers;
                    account login; avatar URL; granted permissions; and
                    repository selection settings.
                  </li>
                  <li>
                    Repository metadata such as names, owners, visibility,
                    default branch, URLs, and enabled-review configuration.
                  </li>
                  <li>
                    Pull request metadata and content needed for reviews,
                    including titles, descriptions, branches, labels,
                    assignees, authors, comments, review events, and diffs.
                  </li>
                  <li>
                    Webhook delivery identifiers and payloads received from
                    GitHub.
                  </li>
                </ul>

                <h3>Review and product usage information</h3>
                <ul>
                  <li>
                    Review run status, generated findings, confidence scores,
                    file paths, line ranges, and related review artifacts.
                  </li>
                  <li>
                    Repository context summaries and embeddings generated to
                    improve review quality.
                  </li>
                  <li>
                    Workspace analytics derived from review activity, such as
                    counts of reviews, findings by severity, and repository
                    usage trends.
                  </li>
                  <li>
                    Compute credit balances, usage debits, and billing-period
                    activity.
                  </li>
                </ul>

                <h3>Billing and payment information</h3>
                <ul>
                  <li>
                    Plan tier, subscription status, billing period dates, Creem
                    customer and subscription identifiers, and payment event
                    metadata.
                  </li>
                  <li>
                    Payment card and bank details are collected and processed
                    directly by our payment provider, not stored by us in full
                    form.
                  </li>
                </ul>

                <h3>Support and communications</h3>
                <ul>
                  <li>
                    Messages you send through in-product feedback, email, or
                    other support channels, along with associated account
                    details needed to respond.
                  </li>
                </ul>

                <h3>Technical and security information</h3>
                <ul>
                  <li>
                    Server logs, request metadata, error reports, timestamps,
                    and security-related events used to operate and protect the
                    Service.
                  </li>
                  <li>
                    Basic website and infrastructure logs from hosting
                    providers, such as Cloudflare, for our landing pages and
                    application delivery.
                  </li>
                </ul>
              </section>

              <section>
                <h2>3. How we use information</h2>
                <p>We use personal information to:</p>
                <ul>
                  <li>Provide, operate, and maintain the hosted Service.</li>
                  <li>Authenticate users and manage sessions.</li>
                  <li>
                    Connect and sync GitHub workspaces, repositories, and pull
                    requests.
                  </li>
                  <li>
                    Run AI-assisted code reviews and publish results to GitHub.
                  </li>
                  <li>Manage billing, subscriptions, credits, and invoices.</li>
                  <li>
                    Provide workspace analytics, support, and service
                    communications.
                  </li>
                  <li>
                    Monitor performance, troubleshoot issues, prevent abuse,
                    and improve reliability and security.
                  </li>
                  <li>Comply with law and enforce our Terms.</li>
                </ul>
              </section>

              <section>
                <h2>4. GitHub data</h2>
                <p>
                  Scopy accesses GitHub only through the permissions granted to
                  the Scopy GitHub App during installation and repository
                  selection. We use that access to receive events, read pull
                  request content required for review, and post review feedback.
                  We do not request broader access than needed for these
                  functions.
                </p>
                <p>
                  You can revoke access at any time in GitHub settings. If you
                  do, we may retain limited historical records for security,
                  billing, and legal compliance, as described in the Retention
                  section below.
                </p>
              </section>

              <section>
                <h2>5. AI processing</h2>
                <p>
                  To generate reviews, relevant pull request content and
                  repository context may be transmitted to AI inference
                  providers. On hosted plans, we currently use OpenRouter and the
                  model providers available through that service to run review
                  and verification models. We may change model providers or model
                  versions over time.
                </p>
                <p>
                  When semantic code search is enabled, code chunks may also be
                  embedded and stored in a vector database, such as Qdrant, to
                  help the review system locate related code. You should not
                  connect repositories containing information you are not
                  permitted to share with these providers.
                </p>
                <p>
                  We do not use your repository content to train public
                  foundation models on your behalf. Model providers may have
                  their own terms and data handling practices, and we select
                  providers intended for production API use, but you should
                  review provider policies if your compliance program requires
                  it.
                </p>
              </section>

              <section>
                <h2>6. Cookies and similar technologies</h2>
                <p>
                  The Scopy web application uses essential cookies and similar
                  technologies to keep you signed in, protect sessions, and
                  remember necessary preferences. These cookies are required for
                  core functionality.
                </p>
                <p>
                  Our public landing site does not use third-party advertising
                  or behavioral analytics cookies at the time of this policy.
                  Infrastructure providers may still process limited technical
                  data, such as IP address and request logs, when delivering the
                  site.
                </p>
                <p>
                  You can control cookies through your browser settings. Disabling
                  essential cookies may prevent you from using the hosted
                  application.
                </p>
              </section>

              <section>
                <h2>7. International data transfers</h2>
                <p>
                  We may process and store information in countries other than
                  the one where you live, including the United States and
                  countries where our subprocessors operate. Where required by
                  law, we use appropriate safeguards for cross-border transfers,
                  such as Standard Contractual Clauses or equivalent mechanisms.
                </p>
              </section>

              <section>
                <h2>8. Data retention</h2>
                <p>
                  We retain personal information only for as long as necessary
                  for the purposes described in this policy:
                </p>
                <ul>
                  <li>
                    <strong>Account and workspace data:</strong> while your
                    account or workspace connection is active and for a
                    reasonable period afterward to handle support, billing, and
                    legal obligations.
                  </li>
                  <li>
                    <strong>Repository and pull request data:</strong> while
                    the repository remains connected and enabled, and for a
                    limited period after disconnection so you can reconnect or
                    resolve billing and support issues.
                  </li>
                  <li>
                    <strong>Review artifacts and analytics:</strong> for as long
                    as needed to provide workspace history, analytics, and
                    product functionality, unless deleted earlier through
                    account or workspace removal.
                  </li>
                  <li>
                    <strong>Billing and transaction records:</strong> for the
                    period required by tax, accounting, and payment law,
                    typically several years.
                  </li>
                  <li>
                    <strong>Security and operational logs:</strong> for a
                    limited rolling period unless needed longer to investigate
                    incidents or meet legal obligations.
                  </li>
                </ul>
                <p>
                  You may request deletion by contacting{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>.
                  Some information may be retained in backups for a limited
                  time or where retention is required by law.
                </p>
              </section>

              <section>
                <h2>9. Security</h2>
                <p>
                  We use reasonable technical and organizational measures
                  designed to protect personal information, including access
                  controls, encryption in transit, segmented production
                  environments, and restricted access to production systems and
                  secrets. No method of transmission or storage is completely
                  secure, and we cannot guarantee absolute security.
                </p>
              </section>

              <section>
                <h2>10. Automated decision-making</h2>
                <p>
                  Scopy uses automated systems, including AI models, to
                  generate code review suggestions and post them to GitHub. These
                  outputs are advisory and do not by themselves produce legal or
                  similarly significant effects on you. You and your team remain
                  responsible for deciding whether to act on review feedback.
                </p>
              </section>

              <section>
                <h2>11. Children&apos;s privacy</h2>
                <p>
                  The Service is not directed to children under 18, and we do
                  not knowingly collect personal information from children. If
                  you believe a child has provided us personal information,
                  contact us and we will take appropriate steps to delete it.
                </p>
              </section>

              <section>
                <h2>12. Changes to this Privacy Policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. When we
                  do, we will revise the &ldquo;Last updated&rdquo; date above
                  and, where required, provide additional notice. We review this
                  policy at least annually and update it when our data practices
                  or subprocessors change materially.
                </p>
              </section>

              <section>
                <h2>13. Contact</h2>
                <p>
                  Privacy questions or requests can be sent to{" "}
                  <a href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>.
                  You may also contact us through{" "}
                  <a href={env.githubUrl} {...externalLinkProps(env.githubUrl)}>
                    GitHub
                  </a>
                  .
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  )
}
