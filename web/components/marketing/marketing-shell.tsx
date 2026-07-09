import Link from "next/link"

import { Button } from "@/components/ui/button"

import { marketingCss } from "./marketing-styles"

/**
 * The chrome every marketing page shares. Nav links are absolute (`/#how`)
 * rather than bare fragments so they still resolve from `/privacy`, `/terms`,
 * and `/about`.
 *
 * `/login` decides for itself where a signed-in visitor belongs, which is why
 * the nav can link there unconditionally without doing any auth work here.
 */

function Wordmark({ className = "gl-wordmark" }: { className?: string }) {
  return (
    <Link href="/" className={className}>
      Glint<span className="gl-dot">.</span>
    </Link>
  )
}

function MarketingNav() {
  return (
    <header className="gl-nav">
      <Wordmark />
      <nav className="gl-nav-links">
        <Link href="/#how" className="gl-navlink">
          How it works
        </Link>
        <Link href="/#pricing" className="gl-navlink">
          Pricing
        </Link>
        <Link href="/#faq" className="gl-navlink">
          FAQ
        </Link>
        <Link href="/login" className="gl-navlink">
          Sign in
        </Link>
        <Button asChild size="sm">
          <Link href="/signup">Start scoring</Link>
        </Button>
      </nav>
    </header>
  )
}

const FOOT_PRODUCT = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/signup", label: "Start scoring" },
]

const FOOT_COMPANY = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "mailto:biplob@weeziq.com", label: "Contact" },
]

function MarketingFooter() {
  return (
    <footer className="gl-footer">
      <div className="gl-foot-band">
        <div className="gl-foot-top">
          <div className="gl-foot-brand">
            <Wordmark />
            <p className="gl-foot-note">
              Score LinkedIn leads against your ideal customer as you browse. No
              login handed over, no bots, no scraping farms.
            </p>
          </div>

          <div>
            <p className="gl-foot-col-title gl-mono">Product</p>
            <ul className="gl-foot-links">
              {FOOT_PRODUCT.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="gl-foot-link">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="gl-foot-col-title gl-mono">Company</p>
            <ul className="gl-foot-links">
              {FOOT_COMPANY.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="gl-foot-link">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="gl-foot-bottom">
          <p className="gl-foot-fine">
            &copy; {new Date().getFullYear()} Glint. All rights reserved.
          </p>
          <p className="gl-foot-fine">
            Not affiliated with, endorsed by, or sponsored by LinkedIn
            Corporation.
          </p>
        </div>
      </div>
    </footer>
  )
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="gl-root">
      <style>{marketingCss}</style>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  )
}

/** The dark title band that opens every sub-page, standing in for the hero. */
export function Masthead({
  kicker,
  title,
  sub,
  meta,
}: {
  kicker: string
  title: string
  sub: string
  meta?: string
}) {
  return (
    <section className="gl-screen gl-masthead">
      <div className="gl-band gl-mast-inner">
        <p className="gl-eyebrow gl-mono">{kicker}</p>
        <h1 className="gl-display gl-mast-h">{title}</h1>
        <p className="gl-mast-sub">{sub}</p>
        {meta && <p className="gl-mast-meta gl-mono">{meta}</p>}
      </div>
    </section>
  )
}
