import Link from "next/link"

import { MarketingShell } from "@/components/marketing/marketing-shell"
import { Button } from "@/components/ui/button"

type Lead = {
  initials: string
  name: string
  headline: string
  score: number
  /** reveal order in the hero stream */
  step: number
}

// Served straight out of web/public. A stable path, not a versioned filename:
// the hero must never link at a build that a later `wxt zip` has replaced.
const EXTENSION_ZIP = "/glint-extension.zip"

// Illustrative hero stream — a spread of scores so the range reads at a glance.
const STREAM: Lead[] = [
  { initials: "PN", name: "Priya N.", headline: "VP Sales · Series B SaaS", score: 92, step: 0 },
  { initials: "CL", name: "Chen L.", headline: "Head of Growth · Fintech", score: 88, step: 1 },
  { initials: "MD", name: "Marcus D.", headline: "Founder · 3-person agency", score: 74, step: 2 },
  { initials: "TR", name: "Tomas R.", headline: "Recruiter · staffing firm", score: 34, step: 3 },
  { initials: "SR", name: "Sam R.", headline: "Student · seeking internships", score: 19, step: 4 },
]

function tone(score: number): "hi" | "mid" | "lo" {
  if (score >= 80) return "hi"
  if (score >= 50) return "mid"
  return "lo"
}

const TRUST = [
  "No LinkedIn login",
  "Reads only what's on screen",
  "Live sync to your inbox",
]

// The old way carries no green anywhere — the absence is the argument.
const OLD_WAY = [
  "Export a list of five thousand names, then guess which two hundred are worth a message.",
  "Bolt on a scraper or a bot and quietly put your account at risk.",
  "Spend an evening tabbing between a profile and a spreadsheet, copying rows by hand.",
  "By the time the list is clean, the hiring post that made them a lead is three weeks cold.",
]

const NEW_WAY = [
  "Scores appear on the profiles and posts you were already going to open.",
  "Glint reads the rendered page. It never clicks, never navigates, never logs in as you.",
  "Strong matches stream into an inbox on their own, with company, role, and context attached.",
  "You act on the signal the day it appears, because you saw it the day it appeared.",
]

const STEPS = [
  {
    n: "01",
    title: "Describe who you sell to",
    body: "Paste your website. Glint drafts your ideal customer — roles, company types, pain points — and you edit it in a minute.",
  },
  {
    n: "02",
    title: "Pair the extension",
    body: "Generate a code in Glint, paste it into the extension. Your LinkedIn login stays in your own browser, always.",
  },
  {
    n: "03",
    title: "Browse like you already do",
    body: "Search, scroll, open profiles. Glint scores what's on screen and streams the strong matches into your inbox, live.",
  },
]

// One lead, dissected — the "anatomy of a score" centerpiece.
const ANATOMY = {
  initials: "PN",
  name: "Priya N.",
  headline: "VP Sales · Series B SaaS · Austin, TX",
  score: 92,
  source: "profile",
  reasons: [
    "VP-level — owns the buying decision",
    "Series B SaaS — inside your ICP",
    "Hiring 4 AEs — active growth signal",
  ],
}

// The ICP line does double duty: it answers "is this for me" and shows what an
// ICP actually looks like, which nothing else on the page demonstrates.
const USE_CASES = [
  {
    role: "Solo founder",
    icp: "Heads of Ops at 20–100 person logistics companies who post about manual workflows",
    body: "Your whole sales team is you, and prospecting competes with shipping. Score while you scroll instead of blocking out an afternoon for it.",
  },
  {
    role: "Agency",
    icp: "Marketing leads at DTC brands doing $1M–$10M who just raised or just rebranded",
    body: "Keep a separate ideal customer per client. Switch sites in Glint and every new score follows the client you're prospecting for.",
  },
  {
    role: "Recruiter",
    icp: "Senior React engineers, 5+ years, open to work, in the EU time zones",
    body: "Nothing says an ideal customer has to be a buyer. Flip the ICP and Glint scores candidates against the role you're filling.",
  },
  {
    role: "SDR & AE",
    icp: "VP Sales at Series A–C SaaS companies actively hiring account executives",
    body: "Stop pasting names into a sheet between calls. The inbox fills itself while you work the list you already have.",
  },
]

const SAFETY = [
  {
    title: "Your credentials never leave your browser",
    body: "Glint reads the page you're already viewing. It never sees, stores, or transmits your LinkedIn login.",
  },
  {
    title: "A passenger, not a driver",
    body: "The extension never clicks, navigates, or opens tabs on its own. It scores what you choose to look at — nothing more.",
  },
  {
    title: "Every lead is scoped to you",
    body: "Leads are locked to your account with row-level security. No shared pools, no scraping farms.",
  },
]

// NOTE: prices are placeholders — swap for real numbers before shipping.
const TIERS = [
  {
    name: "Free",
    price: "$0",
    unit: "",
    note: "For trying it out",
    features: ["Score up to 50 leads / mo", "1 ideal customer profile", "Live inbox sync"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$29",
    unit: "/mo",
    note: "For active outbound",
    features: ["Unlimited scoring", "3 ICPs", "Priority scoring speed", "Export leads to CSV"],
    cta: "Start scoring",
    featured: true,
  },
  {
    name: "Agency",
    price: "$79",
    unit: "/mo",
    note: "For teams & agencies",
    features: ["Everything in Pro", "Up to 10 seats", "Shared ICP library", "Priority support"],
    cta: "Talk to us",
    featured: false,
  },
]

const FAQ = [
  {
    q: "Will this get my LinkedIn account banned?",
    a: "Glint is a passenger, not a driver. It never clicks, scrolls, navigates, or opens tabs on its own — it only reads what you're already looking at. That passive behavior keeps risk close to zero, unlike bots and auto-scrapers.",
  },
  {
    q: "Do you need my LinkedIn login?",
    a: "Never. Your LinkedIn session stays in your own browser. Glint reads the rendered page, not your credentials — nothing about your login ever reaches our servers.",
  },
  {
    q: "How are scores calculated?",
    a: "Each profile or post is graded 0–100 against your ideal customer profile, with the specific reasons shown alongside — so you can trust the number instead of guessing. The grading is done by a large language model, which means the text of the profile you're viewing is sent to our model provider to be scored. See our privacy policy for exactly what that involves.",
  },
  {
    q: "What data do you store?",
    a: "Only the lead details you'd write down anyway: name, company, role, post context, and LinkedIn URL. Every record is locked to your account with row-level security. We never sell it.",
  },
  {
    q: "Which browser do I need?",
    a: "Chrome today. The extension is built cross-browser, so Firefox and Safari are on the way.",
  },
  {
    q: "Can I change who I'm targeting?",
    a: "Anytime. Edit your ICP in the app and every new score reflects it immediately.",
  },
]

function ScoreBadge({ score }: { score: number }) {
  return <span className={`gl-badge gl-mono gl-${tone(score)}`}>{score}</span>
}

export function Landing() {
  return (
    <MarketingShell>
      {/* ── Hero (screen) ─────────────────────────── */}
      <section className="gl-screen gl-hero">
        <div className="gl-hero-inner">
          <div className="gl-hero-copy">
            <p className="gl-eyebrow gl-mono">Lead scoring, inline</p>
            <h1 className="gl-display gl-h1">
              Your best leads are already on your screen.
            </h1>
            <p className="gl-sub">
              Glint reads the LinkedIn profiles and posts you&apos;re already
              looking at, scores each one against your ideal customer, and
              streams the strong matches into an inbox — with the context to
              reach out.
            </p>
            <div className="gl-cta-row">
              <Button asChild>
                <Link href="/signup">
                  Start scoring <span aria-hidden>→</span>
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            {/* The build is unpacked and unsigned, so it cannot be installed by
                opening the file. Saying so here costs a line and saves the
                download from being a dead end. `chrome://extensions` is not a
                link on purpose: Chrome refuses to navigate to it from a page. */}
            <div className="gl-get">
              <p className="gl-get-row">
                <a className="gl-get-link" href={EXTENSION_ZIP} download>
                  <span className="gl-get-arrow" aria-hidden>
                    ↓
                  </span>
                  <span className="gl-get-label">
                    Download the Chrome extension
                  </span>
                </a>
                {/* Outside the anchor: the size describes the download, it is
                    not part of what you click. */}
                <span className="gl-mono gl-get-size">zip · 108 KB</span>
              </p>
              <p className="gl-get-note gl-mono">
                Unzip, then load the folder at chrome://extensions with
                Developer mode on.
              </p>
            </div>
            <ul className="gl-trust">
              {TRUST.map((t) => (
                <li key={t} className="gl-trust-item gl-mono">
                  <span className="gl-check" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Signature: the living scored stream */}
          <div className="gl-demo" aria-hidden>
            <div className="gl-demo-bar">
              <span className="gl-live-dot" />
              <span className="gl-mono gl-demo-url">linkedin.com/search</span>
              <span className="gl-inbox-pill gl-mono">
                <span className="gl-inbox-dot" />2 → inbox
              </span>
            </div>
            <div className="gl-feed">
              {STREAM.map((r) => (
                <div
                  key={r.initials}
                  className="gl-card"
                  style={{ ["--s" as string]: r.step }}
                >
                  <span className="gl-avatar gl-mono">{r.initials}</span>
                  <div className="gl-card-text">
                    <span className="gl-name">{r.name}</span>
                    <span className="gl-headline">{r.headline}</span>
                  </div>
                  <ScoreBadge score={r.score} />
                  <span className="gl-glint" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem → Solution (paper) ────────────── */}
      <section id="why" className="gl-paper gl-section">
        <div className="gl-band">
          <p className="gl-kicker gl-mono">/ the problem</p>
          <h2 className="gl-display gl-h2">
            Prospecting is a filtering job you still do by hand.
          </h2>
          <p className="gl-ps-lede">
            Every tool in the category hands you more names. None of them tell
            you which ones are worth your afternoon. So the filtering falls back
            on you, one browser tab at a time.
          </p>

          <div className="gl-ps">
            <div className="gl-ps-col gl-ps-old">
              <p className="gl-ps-label gl-mono">The old way</p>
              <ul className="gl-ps-list">
                {OLD_WAY.map((item) => (
                  <li key={item} className="gl-ps-item">
                    <span className="gl-dash" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="gl-ps-col gl-ps-new">
              <p className="gl-ps-label gl-mono">With Glint</p>
              <ul className="gl-ps-list">
                {NEW_WAY.map((item) => (
                  <li key={item} className="gl-ps-item">
                    <span className="gl-reason-tick" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Anatomy of a score (screen) ───────────── */}
      <section className="gl-screen gl-section">
        <div className="gl-band gl-anatomy">
          <div className="gl-anatomy-copy">
            <p className="gl-kicker gl-mono">/ the score</p>
            <h2 className="gl-display gl-h2 gl-h2-light">
              Every match arrives with its reasoning.
            </h2>
            <p className="gl-anatomy-sub">
              A score is a number you can act on, not a black box. Glint grades
              each profile 0–100 against your ICP and shows you exactly why —
              so you know who&apos;s worth a message before you write it.
            </p>
            <div className="gl-legend">
              <span className="gl-legend-item gl-mono"><i className="gl-swatch gl-sw-hi" />80–100 · reach out</span>
              <span className="gl-legend-item gl-mono"><i className="gl-swatch gl-sw-mid" />50–79 · maybe</span>
              <span className="gl-legend-item gl-mono"><i className="gl-swatch gl-sw-lo" />0–49 · skip</span>
            </div>
          </div>

          <figure className="gl-anatomy-card">
            <div className="gl-ac-head">
              <span className="gl-avatar gl-avatar-lg gl-mono">{ANATOMY.initials}</span>
              <div className="gl-card-text">
                <span className="gl-name gl-name-lg">{ANATOMY.name}</span>
                <span className="gl-headline">{ANATOMY.headline}</span>
              </div>
              <span className="gl-source gl-mono">{ANATOMY.source}</span>
            </div>

            <div className="gl-meter">
              <div className="gl-meter-top">
                <span className="gl-meter-label gl-mono">match score</span>
                <span className="gl-meter-num gl-mono">{ANATOMY.score}</span>
              </div>
              <div className="gl-track">
                <span className="gl-track-zone gl-tz-lo" />
                <span className="gl-track-zone gl-tz-mid" />
                <span className="gl-track-zone gl-tz-hi" />
                <span
                  className="gl-track-marker"
                  style={{ ["--v" as string]: `${ANATOMY.score}%` }}
                />
              </div>
            </div>

            <ul className="gl-reasons">
              {ANATOMY.reasons.map((reason) => (
                <li key={reason} className="gl-reason">
                  <span className="gl-reason-tick" aria-hidden />
                  {reason}
                </li>
              ))}
            </ul>
          </figure>
        </div>
      </section>

      {/* ── How it works (paper) ──────────────────── */}
      <section id="how" className="gl-paper gl-section">
        <div className="gl-band">
          <p className="gl-kicker gl-mono">/ setup</p>
          <h2 className="gl-display gl-h2">Three steps, then it runs itself.</h2>
          <ol className="gl-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="gl-step">
                <span className="gl-step-n gl-mono">{s.n}</span>
                <h3 className="gl-step-title">{s.title}</h3>
                <p className="gl-step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Use cases (screen) ────────────────────── */}
      <section id="use-cases" className="gl-screen gl-section">
        <div className="gl-band">
          <p className="gl-kicker gl-mono">/ who it&apos;s for</p>
          <h2 className="gl-display gl-h2 gl-h2-light">
            One ICP. Very different jobs.
          </h2>
          <p className="gl-uc-sub">
            Glint doesn&apos;t care what you&apos;re looking for — only that you
            can describe it. Here&apos;s what four people write, and what the
            scoring does for each of them.
          </p>

          <div className="gl-uc">
            {USE_CASES.map((u) => (
              <article key={u.role} className="gl-uc-card">
                <p className="gl-uc-role gl-mono">{u.role}</p>
                <div className="gl-uc-icp">
                  <span className="gl-uc-icp-label gl-mono">Their ICP</span>
                  <span className="gl-uc-icp-text">&ldquo;{u.icp}&rdquo;</span>
                </div>
                <p className="gl-uc-body">{u.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Safety / objections (paper) ───────────── */}
      <section id="safety" className="gl-paper gl-section">
        <div className="gl-band">
          <p className="gl-kicker gl-mono">/ safety</p>
          <h2 className="gl-display gl-h2">Built to keep your account yours.</h2>
          <p className="gl-safety-lede">
            The riskiest thing a LinkedIn tool can do is act like a bot. Glint
            was designed from the first line of code not to.
          </p>
          <div className="gl-safety-grid">
            {SAFETY.map((s) => (
              <div key={s.title} className="gl-safe">
                <h3 className="gl-safe-title">{s.title}</h3>
                <p className="gl-safe-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing (screen) ──────────────────────── */}
      <section id="pricing" className="gl-screen gl-section">
        <div className="gl-band">
          <p className="gl-kicker gl-mono">/ pricing</p>
          <h2 className="gl-display gl-h2 gl-h2-light">Start free. Upgrade when it&apos;s paying off.</h2>
          <div className="gl-tiers">
            {TIERS.map((t) => (
              <div key={t.name} className={`gl-tier${t.featured ? " gl-tier-on" : ""}`}>
                {t.featured && <span className="gl-tier-flag gl-mono">Most popular</span>}
                <span className="gl-tier-name gl-mono">{t.name}</span>
                <p className="gl-tier-price">
                  {t.price}
                  {t.unit && <span className="gl-tier-unit">{t.unit}</span>}
                </p>
                <p className="gl-tier-note">{t.note}</p>
                <ul className="gl-tier-features">
                  {t.features.map((f) => (
                    <li key={f} className="gl-tier-feat">
                      <span className="gl-reason-tick" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={t.featured ? "default" : "outline"}
                  className="w-full"
                >
                  <Link href="/signup">
                    {t.cta} <span aria-hidden>→</span>
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ (paper) ───────────────────────────── */}
      <section id="faq" className="gl-paper gl-section">
        <div className="gl-band gl-faq-band">
          <div className="gl-faq-head">
            <p className="gl-kicker gl-mono">/ questions</p>
            <h2 className="gl-display gl-h2">The things people ask first.</h2>
          </div>
          <div className="gl-faq">
            {FAQ.map((item) => (
              <details key={item.q} className="gl-faq-item">
                <summary className="gl-faq-q">
                  {item.q}
                  <span className="gl-faq-mark" aria-hidden />
                </summary>
                <p className="gl-faq-a">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA (screen) ────────────────────── */}
      <section className="gl-screen gl-final">
        <div className="gl-band gl-final-inner">
          <p className="gl-eyebrow gl-mono">Start free</p>
          <h2 className="gl-display gl-final-h">
            Turn today&apos;s browsing into tomorrow&apos;s pipeline.
          </h2>
          <Button asChild size="lg">
            <Link href="/signup">
              Start scoring <span aria-hidden>→</span>
            </Link>
          </Button>
          <p className="gl-final-note gl-mono">
            Free to start · No LinkedIn login · Cancel anytime
          </p>
        </div>
      </section>
    </MarketingShell>
  )
}
