import Link from "next/link"

import { Button } from "@/components/ui/button"

type Lead = {
  initials: string
  name: string
  headline: string
  score: number
  /** reveal order in the hero stream */
  step: number
}

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
    a: "Each profile or post is graded 0–100 against your ideal customer profile, with the specific reasons shown alongside — so you can trust the number instead of guessing.",
  },
  {
    q: "What data do you store?",
    a: "Only the lead details you'd write down anyway: name, company, role, post context, and LinkedIn URL. Every record is locked to your account with row-level security.",
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
    <div className="gl-root">
      <style>{css}</style>

      {/* ── Nav (paper) ───────────────────────────── */}
      <header className="gl-nav">
        <span className="gl-wordmark">
          Glint<span className="gl-dot">.</span>
        </span>
        <nav className="gl-nav-links">
          <a href="#how" className="gl-navlink">How it works</a>
          <a href="#pricing" className="gl-navlink">Pricing</a>
          <a href="#faq" className="gl-navlink">FAQ</a>
          <Link href="/login" className="gl-navlink">Sign in</Link>
          <Button asChild size="sm">
            <Link href="/signup">Start scoring</Link>
          </Button>
        </nav>
      </header>

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

      {/* ── Footer (paper) ────────────────────────── */}
      <footer className="gl-footer">
        <span className="gl-wordmark">
          Glint<span className="gl-dot">.</span>
        </span>
        <span className="gl-foot-note">
          Score LinkedIn leads against your ICP as you browse.
        </span>
      </footer>
    </div>
  )
}

const css = `
.gl-root {
  /* Art-directed, fixed palette — independent of app theme so the
     screen/paper duotone always reads. */
  --ink: #0B1512;
  --ink-2: #10201A;
  --paper: #F4F7F4;
  --paper-2: #EAF0EB;
  --snow: #EFF4F0;
  --fog: #9DB0A6;
  --ink-mute: #5A6B62;
  --green: #37D07E;
  --amber: #E3B23C;
  --slate: #7C8A83;
  --line-dark: rgba(255,255,255,0.09);
  --line-lite: rgba(11,21,18,0.10);
  --max: 1140px;

  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}
.gl-root *,
.gl-root *::before,
.gl-root *::after { box-sizing: border-box; }
.gl-root :focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 3px;
  border-radius: 4px;
}
.gl-mono { font-family: var(--font-mono); font-feature-settings: "tnum" 1; }
.gl-display { font-family: var(--font-heading); }

/* ── Band shells ─────────────────────────────── */
.gl-screen { background: var(--ink); color: var(--snow); }
.gl-paper { background: var(--paper); color: var(--ink); }
.gl-band { max-width: var(--max); margin: 0 auto; padding: 0 24px; }
.gl-section { padding: 96px 0; }

/* ── Nav ─────────────────────────────────────── */
.gl-nav {
  max-width: var(--max);
  margin: 0 auto;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gl-wordmark {
  font-family: var(--font-heading);
  font-weight: 800; font-size: 21px; letter-spacing: -0.03em;
}
.gl-dot { color: var(--green); }
.gl-nav-links { display: flex; align-items: center; gap: 26px; }
.gl-navlink { font-size: 14px; color: var(--ink-mute); text-decoration: none; transition: color .15s ease; }
.gl-navlink:hover { color: var(--ink); }

/* ── Hero ────────────────────────────────────── */
.gl-hero { padding-top: 8px; padding-bottom: 92px; position: relative; }
.gl-hero::before {
  /* faint green glow behind the stream */
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(60% 55% at 78% 42%, rgba(55,208,126,0.14), transparent 70%);
}
.gl-hero-inner {
  position: relative;
  max-width: var(--max); margin: 0 auto; padding: 48px 24px 0;
  display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr); gap: 60px; align-items: center;
}
.gl-hero-copy { min-width: 0; }
.gl-eyebrow {
  font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--green); margin: 0 0 22px;
}
.gl-h1 {
  font-weight: 800; letter-spacing: -0.035em; line-height: 0.98;
  font-size: clamp(2.6rem, 5.4vw, 4.3rem); margin: 0 0 24px;
  color: var(--snow);
}
.gl-sub {
  font-size: clamp(1rem, 1.35vw, 1.16rem); line-height: 1.62;
  color: var(--fog); max-width: 40ch; margin: 0 0 34px;
}
.gl-cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 30px; }

.gl-trust { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0; padding: 0; }
.gl-trust-item { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fog); }
.gl-check {
  width: 15px; height: 15px; border-radius: 999px; flex: none;
  background: rgba(55,208,126,0.14);
  border: 1px solid rgba(55,208,126,0.5);
  position: relative;
}
.gl-check::after {
  content: ""; position: absolute; left: 4px; top: 3.5px;
  width: 4px; height: 7px; border: solid var(--green);
  border-width: 0 1.6px 1.6px 0; transform: rotate(42deg);
}

/* ── Demo panel (the signature) ──────────────── */
.gl-demo {
  min-width: 0;
  background: linear-gradient(180deg, #0d1a15, var(--ink));
  border: 1px solid var(--line-dark);
  border-radius: 20px; padding: 14px;
  box-shadow: 0 40px 80px -40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04);
}
.gl-demo-bar {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: var(--fog); padding: 6px 8px 16px;
}
.gl-demo-url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gl-inbox-pill {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--green);
  background: rgba(55,208,126,0.1); border: 1px solid rgba(55,208,126,0.35);
  padding: 4px 10px; border-radius: 999px;
  opacity: 0; animation: gl-pop .5s ease both; animation-delay: 2.4s;
}
.gl-inbox-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--green); }
.gl-live-dot {
  width: 8px; height: 8px; border-radius: 999px; background: var(--green); flex: none;
  box-shadow: 0 0 0 0 rgba(55,208,126,0.6); animation: gl-pulse 2.4s infinite;
}
.gl-feed { display: flex; flex-direction: column; gap: 10px; }
.gl-card {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  background: var(--ink-2); border: 1px solid var(--line-dark);
  border-radius: 13px; padding: 14px 16px;
  opacity: 0; animation: gl-rise .55s ease both; animation-delay: calc(var(--s) * 0.28s);
}
.gl-avatar {
  flex: none; width: 40px; height: 40px; border-radius: 999px;
  display: grid; place-items: center;
  font-size: 13px; color: var(--snow);
  background: linear-gradient(140deg, #1d3b30, #16261f);
  border: 1px solid var(--line-dark);
}
.gl-avatar-lg { width: 46px; height: 46px; font-size: 14px; }
.gl-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gl-name { color: var(--snow); font-size: 14px; font-weight: 600; }
.gl-name-lg { font-size: 15.5px; }
.gl-headline { color: var(--fog); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-badge {
  margin-left: auto; flex: none;
  font-size: 13px; font-weight: 700; padding: 4px 11px; border-radius: 999px;
  opacity: 0; animation: gl-pop .4s ease both; animation-delay: calc(var(--s) * 0.28s + 0.5s);
}
.gl-hi { color: #052e18; background: var(--green); }
.gl-mid { color: #2b1f00; background: var(--amber); }
.gl-lo { color: var(--snow); background: rgba(124,138,131,0.35); border: 1px solid var(--line-dark); }
.gl-glint {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 32%, rgba(255,255,255,0.18) 48%, transparent 62%);
  transform: translateX(-130%);
  animation: gl-sweep .9s ease both; animation-delay: calc(var(--s) * 0.28s + 0.2s);
}

/* ── How it works ────────────────────────────── */
.gl-kicker { font-size: 12px; letter-spacing: 0.12em; color: var(--green); margin: 0 0 14px; }
.gl-h2 {
  font-weight: 800; letter-spacing: -0.03em; line-height: 1.04;
  font-size: clamp(1.9rem, 3.6vw, 2.7rem); margin: 0; color: var(--ink); max-width: 18ch;
}
.gl-h2-light { color: var(--snow); }
.gl-steps {
  list-style: none; margin: 48px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
}
.gl-step { border-top: 2px solid var(--ink); padding-top: 18px; }
.gl-step-n { display: block; font-size: 13px; font-weight: 600; color: var(--green); margin-bottom: 16px; letter-spacing: 0.04em; }
.gl-step-title { font-weight: 700; font-size: 1.16rem; letter-spacing: -0.01em; margin: 0 0 9px; color: var(--ink); }
.gl-step-body { font-size: 14.5px; line-height: 1.6; color: var(--ink-mute); margin: 0; }

/* ── Anatomy of a score ──────────────────────── */
.gl-anatomy {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center;
}
.gl-anatomy-copy { min-width: 0; }
.gl-anatomy-sub { font-size: 1.05rem; line-height: 1.62; color: var(--fog); margin: 22px 0 26px; max-width: 42ch; }
.gl-legend { display: flex; flex-direction: column; gap: 10px; }
.gl-legend-item { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--fog); }
.gl-swatch { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.gl-sw-hi { background: var(--green); }
.gl-sw-mid { background: var(--amber); }
.gl-sw-lo { background: var(--slate); }

.gl-anatomy-card {
  min-width: 0;
  margin: 0; background: linear-gradient(180deg, #0e1c16, var(--ink-2));
  border: 1px solid var(--line-dark); border-radius: 18px; padding: 22px;
  box-shadow: 0 40px 80px -44px rgba(0,0,0,0.7);
}
.gl-ac-head { display: flex; align-items: center; gap: 14px; padding-bottom: 20px; border-bottom: 1px solid var(--line-dark); }
.gl-source {
  margin-left: auto; flex: none; font-size: 11px; color: var(--fog);
  border: 1px solid var(--line-dark); border-radius: 6px; padding: 3px 9px; letter-spacing: 0.04em;
}
.gl-meter { padding: 22px 0; }
.gl-meter-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.gl-meter-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fog); }
.gl-meter-num { font-size: 40px; font-weight: 700; color: var(--green); letter-spacing: -0.02em; line-height: 1; }
.gl-track {
  position: relative; height: 12px; border-radius: 999px; overflow: hidden;
  display: flex; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
}
.gl-track-zone { height: 100%; }
.gl-tz-lo { flex: 50; background: rgba(124,138,131,0.28); }
.gl-tz-mid { flex: 30; background: rgba(227,178,60,0.34); }
.gl-tz-hi { flex: 20; background: rgba(55,208,126,0.45); }
.gl-track-marker {
  position: absolute; top: 50%; left: var(--v);
  width: 4px; height: 22px; border-radius: 2px; background: var(--snow);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px rgba(11,21,18,0.7), 0 0 12px 1px rgba(55,208,126,0.8);
  animation: gl-slide 1s cubic-bezier(.2,.8,.2,1) both;
}
.gl-reasons { list-style: none; margin: 0; padding: 20px 0 0; border-top: 1px solid var(--line-dark); display: flex; flex-direction: column; gap: 12px; }
.gl-reason { display: flex; align-items: flex-start; gap: 11px; font-size: 13.5px; color: var(--snow); line-height: 1.4; }
.gl-reason-tick {
  margin-top: 2px; width: 16px; height: 16px; border-radius: 999px; flex: none;
  background: rgba(55,208,126,0.14); border: 1px solid rgba(55,208,126,0.5); position: relative;
}
.gl-reason-tick::after {
  content: ""; position: absolute; left: 4.5px; top: 3.5px;
  width: 4px; height: 7px; border: solid var(--green);
  border-width: 0 1.6px 1.6px 0; transform: rotate(42deg);
}

/* ── Safety ──────────────────────────────────── */
.gl-safety-lede { font-size: 1.06rem; line-height: 1.6; color: var(--ink-mute); margin: 22px 0 44px; max-width: 46ch; }
.gl-safety-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.gl-safe {
  background: #fff; border: 1px solid var(--line-lite);
  border-radius: 16px; padding: 26px 24px;
  box-shadow: 0 1px 0 rgba(11,21,18,0.03);
}
.gl-safe-title { font-weight: 700; font-size: 1.04rem; letter-spacing: -0.01em; margin: 0 0 10px; color: var(--ink); line-height: 1.25; }
.gl-safe-body { font-size: 14px; line-height: 1.62; color: var(--ink-mute); margin: 0; }

/* ── Pricing ─────────────────────────────────── */
.gl-tiers {
  margin-top: 48px;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px;
  align-items: start;
}
.gl-tier {
  position: relative; min-width: 0;
  background: linear-gradient(180deg, #0e1c16, var(--ink-2));
  border: 1px solid var(--line-dark); border-radius: 18px; padding: 28px 24px;
  display: flex; flex-direction: column;
}
.gl-tier-on {
  border-color: rgba(55,208,126,0.55);
  box-shadow: 0 0 0 1px rgba(55,208,126,0.25), 0 30px 60px -34px rgba(55,208,126,0.4);
}
.gl-tier-flag {
  position: absolute; top: -11px; left: 24px;
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: #052e18; background: var(--green); padding: 4px 10px; border-radius: 999px;
}
.gl-tier-name { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fog); }
.gl-tier-price {
  font-family: var(--font-heading); font-weight: 800; letter-spacing: -0.03em;
  font-size: 2.7rem; color: var(--snow); margin: 12px 0 2px; line-height: 1;
}
.gl-tier-unit { font-family: var(--font-sans); font-weight: 500; font-size: 1rem; color: var(--fog); margin-left: 4px; }
.gl-tier-note { font-size: 13.5px; color: var(--fog); margin: 0 0 22px; }
.gl-tier-features { list-style: none; margin: 0 0 26px; padding: 22px 0 0; border-top: 1px solid var(--line-dark); display: flex; flex-direction: column; gap: 13px; flex: 1; }
.gl-tier-feat { display: flex; align-items: flex-start; gap: 11px; font-size: 13.5px; color: var(--snow); line-height: 1.4; }

/* ── FAQ ─────────────────────────────────────── */
.gl-faq-band { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 48px; align-items: start; }
.gl-faq-head { position: sticky; top: 32px; }
.gl-faq { border-top: 1px solid var(--line-lite); }
.gl-faq-item { border-bottom: 1px solid var(--line-lite); }
.gl-faq-q {
  list-style: none; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 20px 0; font-weight: 600; font-size: 1.05rem; color: var(--ink); letter-spacing: -0.01em;
}
.gl-faq-q::-webkit-details-marker { display: none; }
.gl-faq-mark {
  position: relative; flex: none; width: 16px; height: 16px;
}
.gl-faq-mark::before, .gl-faq-mark::after {
  content: ""; position: absolute; background: var(--green);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
}
.gl-faq-mark::before { width: 14px; height: 2px; }
.gl-faq-mark::after { width: 2px; height: 14px; transition: transform .2s ease; }
.gl-faq-item[open] .gl-faq-mark::after { transform: translate(-50%, -50%) scaleY(0); }
.gl-faq-a { margin: 0; padding: 0 40px 22px 0; font-size: 14.5px; line-height: 1.62; color: var(--ink-mute); }

/* ── Final CTA ───────────────────────────────── */
.gl-final { padding: 104px 0; position: relative; overflow: hidden; }
.gl-final::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(50% 80% at 50% 120%, rgba(55,208,126,0.18), transparent 70%);
}
.gl-final-inner { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
.gl-final-h {
  font-weight: 800; letter-spacing: -0.035em; line-height: 1.0;
  font-size: clamp(2rem, 4.6vw, 3.4rem); color: var(--snow);
  margin: 4px 0 32px; max-width: 16ch;
}
.gl-final-note { font-size: 12.5px; color: var(--fog); margin: 22px 0 0; letter-spacing: 0.02em; }

/* ── Footer ──────────────────────────────────── */
.gl-footer {
  background: var(--paper); border-top: 1px solid var(--line-lite);
  max-width: var(--max); margin: 0 auto; padding: 30px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.gl-foot-note { font-size: 13px; color: var(--ink-mute); }

/* ── Motion ──────────────────────────────────── */
@keyframes gl-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes gl-pop { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: none; } }
@keyframes gl-sweep { to { transform: translateX(130%); } }
@keyframes gl-slide { from { left: 0; } }
@keyframes gl-pulse {
  0% { box-shadow: 0 0 0 0 rgba(55,208,126,0.55); }
  70% { box-shadow: 0 0 0 7px rgba(55,208,126,0); }
  100% { box-shadow: 0 0 0 0 rgba(55,208,126,0); }
}

/* ── Responsive ──────────────────────────────── */
@media (max-width: 900px) {
  .gl-hero-inner { grid-template-columns: minmax(0, 1fr); gap: 44px; }
  .gl-anatomy { grid-template-columns: minmax(0, 1fr); gap: 40px; }
  .gl-steps, .gl-safety-grid { grid-template-columns: 1fr; }
  .gl-tiers { grid-template-columns: minmax(0, 1fr); gap: 26px; }
  .gl-tier-features { flex: none; }
  .gl-faq-band { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .gl-faq-head { position: static; }
  .gl-section { padding: 72px 0; }
  .gl-nav-links { gap: 16px; }
}
@media (max-width: 560px) {
  .gl-nav-links .gl-navlink { display: none; }
  .gl-hero-inner { padding-top: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .gl-card, .gl-badge, .gl-glint, .gl-live-dot,
  .gl-inbox-pill, .gl-track-marker { animation: none !important; }
  .gl-card, .gl-badge, .gl-inbox-pill { opacity: 1 !important; }
  .gl-glint { display: none; }
}
`
