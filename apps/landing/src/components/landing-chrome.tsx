import { env, externalLinkProps } from "#/env"

export function LandingNav() {
  return (
    <nav className="l-nav">
      <div className="l-wrap">
        <div className="l-nav-row">
          <a href="/" className="l-logo">
            <span className="l-logo-mark" aria-hidden="true" />
            scopy
          </a>
          <div className="l-nav-right">
            <a
              href={env.githubUrl}
              className="l-nav-a"
              {...externalLinkProps(env.githubUrl)}
            >
              GitHub
            </a>
            <a href={env.docsUrl} className="l-nav-a">
              Docs
            </a>
            <a
              href={env.appUrl}
              className="l-btn l-btn-solid"
              style={{ marginLeft: 6 }}
              {...externalLinkProps(env.appUrl)}
            >
              Get started
            </a>
          </div>
        </div>
      </div>
    </nav>
  )
}

export function LandingFooter() {
  return (
    <footer className="l-footer">
      <div className="l-wrap">
        <div className="l-footer-row">
          <span className="l-footer-copy">
            © {new Date().getFullYear()} Scopy.
          </span>
          <nav className="l-footer-links">
            <a
              href={env.githubUrl}
              className="l-footer-a"
              {...externalLinkProps(env.githubUrl)}
            >
              GitHub
            </a>
            <a href={env.docsUrl} className="l-footer-a">
              Docs
            </a>
            <a href={env.privacyUrl} className="l-footer-a">
              Privacy
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
