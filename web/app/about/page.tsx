import type { Metadata } from "next"
import Link from "next/link"

import { MarketingShell, Masthead } from "@/components/marketing/marketing-shell"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "About · Glint",
  description:
    "Why Glint reads the page instead of scraping it, and the three rules the product is built on.",
}

const PRINCIPLES = [
  {
    title: "A passenger, never a driver",
    body: "Glint reads what you already opened. It does not click, navigate, scroll, or open tabs. Every automation shortcut we declined to take is the reason your account stays yours.",
  },
  {
    title: "A score you can argue with",
    body: "A number without a reason is a black box, and nobody should act on a black box. Every score arrives with the specific evidence behind it, so you can overrule it when it's wrong.",
  },
  {
    title: "Your data has one owner",
    body: "Leads are locked to your account at the database level. There is no shared pool, no resale, no data broker on the other end of this. We sell software, not people's contact details.",
  },
]

export default function AboutPage() {
  return (
    <MarketingShell>
      <Masthead
        kicker="/ about"
        title="Built for people who prospect by reading, not by exporting."
        sub="Glint started from a small irritation: the best lead you'll see all week is usually already on your screen, and you scroll past it."
      />

      <section className="gl-paper">
        <div className="gl-band gl-prose">
          <h2>Why this exists</h2>
          <p>
            The tools in this category all solve the same problem the same way.
            They hand you a bigger list. Ten thousand names, filtered by
            headcount and industry, exported to a spreadsheet you will open once.
            The work that actually matters — deciding which of those names is
            worth an afternoon — is still yours, still manual, and still done one
            browser tab at a time.
          </p>
          <p>
            Meanwhile the signal you needed was sitting in a post you scrolled
            past on Tuesday. Someone announcing they are hiring four account
            executives. Someone complaining about the exact workflow your product
            replaces. You saw it. You did not have the ICP in your head at that
            moment, so you kept scrolling.
          </p>
          <p>
            Glint is the attempt to close that gap. It sits where the signal
            already is, holds your ideal customer in mind so you do not have to,
            and puts a score and a reason next to the person in front of you.
            Nothing gets exported. Nothing gets scraped. You browse the way you
            already browse, and the filtering happens as you go.
          </p>

          <h2>The decision that shaped everything</h2>
          <p>
            Early on there was a fork in the road. Glint could drive the browser
            — open profiles automatically, page through search results, harvest
            at volume. That would have been faster to build and easier to demo,
            and it would have gotten people&apos;s accounts restricted.
          </p>
          <p>
            So we took the slower road. Glint reads the page you rendered, in the
            browser you rendered it in, using the session you were already signed
            into. Your LinkedIn credentials never reach us, because they never
            leave your machine. That single constraint is why the extension is
            passive, why enrichment happens only when you ask for it, and why
            Glint drafts a message but never sends one.
          </p>
          <p>
            It costs us some speed. It is the whole reason the product is safe to
            use.
          </p>

          <h2>What we hold ourselves to</h2>
        </div>

        <div className="gl-band" style={{ paddingBottom: "96px" }}>
          <div className="gl-about-grid" style={{ marginTop: 0 }}>
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="gl-safe">
                <h3 className="gl-safe-title">{p.title}</h3>
                <p className="gl-safe-body">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gl-screen gl-final">
        <div className="gl-band gl-final-inner">
          <p className="gl-eyebrow gl-mono">Say hello</p>
          <h2 className="gl-display gl-final-h">
            We read every email that arrives.
          </h2>
          <div className="gl-cta-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start scoring <span aria-hidden>→</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="mailto:biplob@weeziq.com">Email us</a>
            </Button>
          </div>
          <p className="gl-final-note gl-mono">biplob@weeziq.com</p>
        </div>
      </section>
    </MarketingShell>
  )
}
